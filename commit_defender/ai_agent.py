"""AI review agent using the Azure OpenAI SDK."""

from __future__ import annotations

import json

from .config import AIReviewConfig
from .models import FileComment, LintFinding, ReviewResult
from .settings import load_settings

_SYSTEM_PROMPT = """\
You are commit-defender, an AI code reviewer integrated into a git pre-commit hook.

Your job is to review the provided git diff and static analysis findings, then produce a concise, \
actionable review that helps the developer understand what needs to be fixed before committing.

## Guidelines
- Be direct and specific. Reference file names and line numbers.
- Group related issues together.
- Distinguish between must-fix issues (errors) and suggestions (warnings/style).
- Keep your summary under 300 words.
- Do not repeat every lint finding verbatim — synthesize patterns and highlight the most important ones.
- If the code looks good overall, say so clearly.

## Output format
Respond ONLY with a valid JSON object matching this schema:
{
  "summary": "<concise narrative review, markdown allowed, under 300 words>",
  "blocking": <true if the code should not be committed as-is, false otherwise>,
  "file_comments": [
    {
      "file": "<path relative to repo root, e.g. src/main.py>",
      "line": <1-based line number from the diff; 0 for a file-level comment>,
      "comment": "<short actionable suggestion, markdown allowed>"
    }
  ]
}

Rules for file_comments:
- Only reference lines that appear in the provided diff.
- Limit to at most 10 comments total.
- Omit the array entirely (or use []) if there is nothing specific to annotate.
- Do not include anything outside the JSON object.
"""


class AIReviewAgent:
    def __init__(self, config: AIReviewConfig) -> None:
        self.config = config

    def review(self, diff: str, lint_findings: list[LintFinding]) -> ReviewResult:
        settings = load_settings()

        if not self.config.enabled or settings.skip_ai:
            return ReviewResult.skipped()

        missing = settings.missing_azure_fields()
        if missing:
            return ReviewResult.error(
                f"Missing credentials in ~/.commit-defender.env: {', '.join(missing)}"
            )

        try:
            from openai import (
                AzureOpenAI,
                APIConnectionError,
                APIStatusError,
                APITimeoutError,
                AuthenticationError,
                RateLimitError,
            )
        except ImportError:
            return ReviewResult.error("openai package not installed")

        client = AzureOpenAI(
            api_key=settings.azure_openai_api_key,
            azure_endpoint=settings.azure_openai_endpoint,
            api_version=settings.azure_openai_api_version,
        )

        deployment = settings.azure_openai_deployment or self.config.model

        findings_text = "\n".join(str(f) for f in lint_findings) if lint_findings else "None"

        system_content = _SYSTEM_PROMPT
        if self.config.system_prompt_suffix:
            system_content += f"\n\n## Project-specific context\n{self.config.system_prompt_suffix}"

        user_message = f"""\
## Staged diff

```diff
{diff or '(no diff available)'}
```

## Static analysis findings

```
{findings_text}
```

Please review the above and respond with the JSON object as instructed.
"""

        try:
            response = client.chat.completions.create(
                model=deployment,
                max_completion_tokens=self.config.max_tokens,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_content},
                    {"role": "user", "content": user_message},
                ],
            )

            raw = response.choices[0].message.content.strip()
            data = json.loads(raw)

            file_comments = [
                FileComment(
                    file=fc["file"],
                    line=int(fc.get("line", 0)),
                    comment=fc["comment"],
                )
                for fc in data.get("file_comments", [])
                if "file" in fc and "comment" in fc
            ]
            return ReviewResult(
                summary=data.get("summary", "(no summary)"),
                blocking=bool(data.get("blocking", False)),
                raw_response=raw,
                file_comments=file_comments,
            )

        except AuthenticationError as e:
            return ReviewResult.error(
                f"Authentication failed — check AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT.\n"
                f"  Detail: {e.message}"
            )
        except APIConnectionError as e:
            return ReviewResult.error(
                f"Could not reach Azure OpenAI endpoint '{settings.azure_openai_endpoint}'.\n"
                f"  Check your network and AZURE_OPENAI_ENDPOINT value.\n"
                f"  Detail: {e}"
            )
        except APITimeoutError:
            return ReviewResult.error(
                "Request to Azure OpenAI timed out. "
                "Check network connectivity or increase max_tokens."
            )
        except RateLimitError as e:
            return ReviewResult.error(
                f"Azure OpenAI rate limit exceeded — try again in a moment.\n"
                f"  Detail: {e.message}"
            )
        except APIStatusError as e:
            return ReviewResult.error(
                f"Azure OpenAI returned HTTP {e.status_code}.\n"
                f"  Detail: {e.message}"
            )
        except json.JSONDecodeError as e:
            return ReviewResult.error(f"Could not parse AI response as JSON: {e}")
        except Exception as e:
            return ReviewResult.error(f"Unexpected error: {type(e).__name__}: {e}")
