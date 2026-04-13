"""AI review agent using the Anthropic SDK with prompt caching."""

from __future__ import annotations

import json
import os

from .models import AIReviewConfig, LintFinding, ReviewResult

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
  "summary": "<concise narrative review, markdown allowed>",
  "blocking": <true if you believe the code should not be committed as-is, false otherwise>
}

Do not include anything outside the JSON object.
"""


class AIReviewAgent:
    def __init__(self, config: AIReviewConfig) -> None:
        self.config = config

    def review(self, diff: str, lint_findings: list[LintFinding]) -> ReviewResult:
        if not self.config.enabled or os.environ.get("CD_SKIP_AI", "").strip() == "1":
            return ReviewResult.skipped()

        api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            return ReviewResult.error("ANTHROPIC_API_KEY not set")

        try:
            import anthropic
        except ImportError:
            return ReviewResult.error("anthropic package not installed")

        client = anthropic.Anthropic(api_key=api_key)

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
            response = client.messages.create(
                model=self.config.model,
                max_tokens=self.config.max_tokens,
                system=[
                    {
                        "type": "text",
                        "text": system_content,
                        # Enable prompt caching for the large static system prompt
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_message}],
            )

            raw = response.content[0].text.strip()
            data = json.loads(raw)

            return ReviewResult(
                summary=data.get("summary", "(no summary)"),
                blocking=bool(data.get("blocking", False)),
                raw_response=raw,
            )

        except json.JSONDecodeError as e:
            return ReviewResult.error(f"Could not parse AI response: {e}")
        except Exception as e:
            return ReviewResult.error(str(e))
