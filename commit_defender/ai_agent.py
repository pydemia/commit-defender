"""AI review agent using the Azure OpenAI SDK."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from .config import AIReviewConfig, Config
from .models import FileComment, LintFinding, ReviewResult, VALID_GRADES, GRADE_RANK, worst_grade
from .settings import Settings, load_settings

# ── Skill loader ──────────────────────────────────────────────────────────────

def _load_skills(repo_path: Path) -> str:
    """Read all SKILL.md files from <repo>/.commit-defender/*/SKILL.md.

    Returns a formatted string ready to embed in the system prompt, or an
    empty string if no skill directory exists.
    """
    skill_dir = repo_path / ".commit-defender"
    if not skill_dir.is_dir():
        return ""

    sections: list[str] = []
    for skill_md in sorted(skill_dir.glob("*/SKILL.md")):
        category = skill_md.parent.name
        content = skill_md.read_text(encoding="utf-8").strip()
        sections.append(f"### [{category}]\n\n{content}")

    if not sections:
        return ""

    return "## Active Review Skills\n\n" + "\n\n---\n\n".join(sections)


# ── Behavior modifiers ────────────────────────────────────────────────────────

_SEVERITY_PROMPTS: dict[str, str] = {
    "severe": (
        "Apply the absolute strictest possible review. Flag every deviation from "
        "best practice, every style inconsistency, every potential issue — no matter "
        "how minor. Zero tolerance."
    ),
    "rigorous": (
        "Apply a strict review. Flag most issues including minor style and "
        "best-practice deviations. Err on the side of raising concerns."
    ),
    "moderate": (
        "Apply a balanced review. Flag meaningful issues and genuine best-practice "
        "violations, but do not nitpick trivial style details."
    ),
    "generous": (
        "Apply a lenient review. Only flag significant issues that carry clear risk "
        "or that deviate substantially from convention. Allow minor imperfections."
    ),
    "lean": (
        "Apply a minimal review. Only flag critical issues: those that will break "
        "functionality, introduce security vulnerabilities, or cause data loss."
    ),
}

_RICHNESS_PROMPTS: dict[str, str] = {
    "colorful": (
        "For each finding, provide an elaborate explanation: describe the problem in "
        "depth, give a concrete example of the fix, explain the reasoning, and mention "
        "any trade-offs. The summary may be up to 600 words."
    ),
    "chatty": (
        "For each finding, provide helpful context and a suggested fix. "
        "The summary should be thorough but focused, up to 400 words."
    ),
    "moderate": (
        "Provide clear, concise explanations for each finding. "
        "Keep the summary under 300 words."
    ),
    "simple": (
        "Be brief. One or two sentences per finding. "
        "Keep the summary under 150 words."
    ),
    "silent": (
        "Output one-line descriptions only. No elaboration, no examples, no context. "
        "Keep the summary under 60 words."
    ),
}

_LOCALE_PROMPTS: dict[str, str] = {
    "en": "Write all output in English.",
    "ko": "모든 출력을 한국어로 작성하세요.",
}

_CATEGORIES = (
    "correctness | security | maintenance | optimization | review-history | setting"
)

_COMMENT_SCHEMA = """\
    {
      "file": "<path relative to repo root, e.g. src/main.py>",
      "line": <1-based line number; 0 for a file-level comment>,
      "category": "<one of: correctness | security | maintenance | optimization | review-history | setting>",
      "comment": "<actionable suggestion, markdown allowed>"
    }"""

_BASE_SYSTEM_PROMPT_DIFF = f"""\
You are commit-defender, an AI code reviewer integrated into a git pre-commit hook.

Your job is to review the provided git diff and static analysis findings, then produce a
concise, actionable review that helps the developer understand what needs to be fixed
before committing.

## Review categories
Every file comment must be tagged with one of these categories:
- **correctness** — logic errors, type issues, null/undefined safety, off-by-one, missing tests
- **security** — secrets, injection, broken auth, crypto weaknesses, OWASP Top 10
- **maintenance** — readability, naming, code conventions, structure, comments
- **optimization** — performance, complexity, N+1 queries, memory leaks
- **review-history** — recurring review patterns, MR best practices, knowledge transfer
- **setting** — env vars, secrets management, deployment config, infrastructure safety

## Code quality grade
Assign ONE grade that reflects the overall quality of the reviewed code:
- **exceptional** — Exemplary code. Clean, secure, well-structured. Best practices throughout. No significant issues.
- **proficient** — Good code. Minor issues only; nothing blocking.
- **adequate** — Acceptable code. Notable issues that should be fixed but are not blocking.
- **insufficient** — Significant problems that need addressing before this can be considered ready.
- **critical** — Severe issues: security vulnerabilities, data-loss risk, or logic-breaking bugs. Must not be committed as-is.

## Core guidelines
- Be direct and specific. Reference file names and line numbers.
- Group related issues together.
- Distinguish between must-fix issues (errors) and suggestions (warnings/style).
- Do not repeat every lint finding verbatim — synthesize patterns and highlight the most important ones.
- If the changes look good overall, say so clearly.

## Output format
Respond ONLY with a valid JSON object matching this schema:
{{
  "summary": "<narrative review, markdown allowed>",
  "blocking": <true if the code should not be committed as-is, false otherwise>,
  "grade": "<one of: exceptional | proficient | adequate | insufficient | critical>",
  "file_comments": [
{_COMMENT_SCHEMA}
  ]
}}

Rules for file_comments:
- Only reference lines that appear in the provided diff.
- Limit to at most 15 comments total.
- Every comment must include a "category" field.
- Omit the array (or use []) if there is nothing specific to annotate.
- Do not include anything outside the JSON object.
"""

_BASE_SYSTEM_PROMPT_FILE = f"""\
You are commit-defender, an AI code reviewer.

Your job is to review the provided file contents and static analysis findings, then
produce a concise, actionable review that helps the developer improve the code.

## Review categories
Every file comment must be tagged with one of these categories:
- **correctness** — logic errors, type issues, null/undefined safety, off-by-one, missing tests
- **security** — secrets, injection, broken auth, crypto weaknesses, OWASP Top 10
- **maintenance** — readability, naming, code conventions, structure, comments
- **optimization** — performance, complexity, N+1 queries, memory leaks
- **review-history** — recurring review patterns, MR best practices, knowledge transfer
- **setting** — env vars, secrets management, deployment config, infrastructure safety

## Code quality grade
Assign ONE grade that reflects the overall quality of the reviewed code:
- **exceptional** — Exemplary code. Clean, secure, well-structured. Best practices throughout. No significant issues.
- **proficient** — Good code. Minor issues only; nothing blocking.
- **adequate** — Acceptable code. Notable issues that should be fixed but are not blocking.
- **insufficient** — Significant problems that need addressing before this can be considered ready.
- **critical** — Severe issues: security vulnerabilities, data-loss risk, or logic-breaking bugs. Must not be committed as-is.

## Core guidelines
- Be direct and specific. Reference file names and exact line numbers.
- Group related issues together.
- Distinguish between must-fix issues (bugs, security) and suggestions (style, design).
- Do not repeat every lint finding verbatim — synthesize patterns and highlight important ones.
- If the code looks good overall, say so clearly.

## Output format
Respond ONLY with a valid JSON object matching this schema:
{{
  "summary": "<narrative review, markdown allowed>",
  "blocking": false,
  "grade": "<one of: exceptional | proficient | adequate | insufficient | critical>",
  "file_comments": [
{_COMMENT_SCHEMA}
  ]
}}

Rules for file_comments:
- You may reference any line number in the file — not limited to changed lines.
- Limit to at most 20 comments total across all files.
- Every comment must include a "category" field.
- Omit the array (or use []) if there is nothing specific to annotate.
- Do not include anything outside the JSON object.
"""


def _build_system_prompt(
    settings: Settings,
    config: Config,
    skills_text: str,
    project_suffix: str,
    review_mode: str = "diff",
) -> str:
    base = _BASE_SYSTEM_PROMPT_FILE if review_mode == "file" else _BASE_SYSTEM_PROMPT_DIFF
    parts = [base]

    if skills_text:
        parts.append(skills_text)

    # Priority: env var (set by VS Code / hook) > .commit-defender/settings.json > built-in default
    rs = config.review_settings
    severity = settings.cd_severity_level.strip().lower() or rs.severityLevel
    richness = settings.cd_richness_level.strip().lower() or rs.richnessLevel
    locale   = settings.cd_locale.strip().lower()          or rs.locale

    modifier_lines = [
        f"- Severity: {_SEVERITY_PROMPTS.get(severity, _SEVERITY_PROMPTS['moderate'])}",
        f"- Detail level: {_RICHNESS_PROMPTS.get(richness, _RICHNESS_PROMPTS['moderate'])}",
        f"- Language: {_LOCALE_PROMPTS.get(locale, _LOCALE_PROMPTS['en'])}",
    ]
    parts.append("## Review behavior\n\n" + "\n".join(modifier_lines))

    if project_suffix:
        parts.append(f"## Project-specific context\n\n{project_suffix}")

    return "\n\n".join(parts)


# ── JSON parsing ─────────────────────────────────────────────────────────────

def _parse_json(raw: str) -> dict:
    """Parse JSON from the model response, stripping markdown fences if present.

    Tries three strategies in order:
    1. Direct parse (works when response_format=json_object is honoured).
    2. Strip ``` fences and parse the inner block.
    3. Scan for the first complete top-level {...} object (handles prose wrapping).
    """
    # 1. Direct parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # 2. Strip markdown fences — model sometimes wraps in ```json ... ```
    stripped = re.sub(r'^```(?:json)?\s*', '', raw.strip(), flags=re.MULTILINE)
    stripped = re.sub(r'```\s*$', '', stripped.strip(), flags=re.MULTILINE)
    try:
        return json.loads(stripped.strip())
    except json.JSONDecodeError:
        pass

    # 3. Find the first complete {...} block using brace counting (not greedy regex)
    depth = 0
    start = None
    for i, ch in enumerate(raw):
        if ch == '{':
            if start is None:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start is not None:
                candidate = raw[start:i + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    # Keep scanning for another candidate
                    start = None

    raise json.JSONDecodeError("No valid JSON found in response", raw, 0)


# ── Agent ─────────────────────────────────────────────────────────────────────

class AIReviewAgent:
    def __init__(self, config: AIReviewConfig, full_config: Config | None = None) -> None:
        self.config = config
        self._full_config = full_config

    # ── Per-file looped inference ─────────────────────────────────────────────

    def review_files_separately(
        self,
        files: list[Path],
        lint_findings: list[LintFinding],
        repo_path: Path | None = None,
    ) -> ReviewResult:
        """Review each file with a separate AI call and merge the results.

        This avoids max_tokens truncation: each call only carries one file's
        content, so even large files get a full review instead of being silently
        cut off mid-JSON.  Results are aggregated into a single ReviewResult.
        """
        from .diff_extractor import DiffExtractor

        if not files:
            return ReviewResult.skipped()

        extractor = DiffExtractor(repo_path or Path("."))
        all_comments: list[FileComment] = []
        summaries: list[str] = []
        grades: list[str] = []
        blocking = False
        total = len(files)

        for idx, file_path in enumerate(files, start=1):
            rel = str(file_path.relative_to(repo_path)) if repo_path else str(file_path)
            print(
                f"[commit-defender] AI review {idx}/{total}: {rel}",
                file=sys.stderr, flush=True,
            )

            # Full content for this single file
            content = extractor.get_file_contents([file_path])

            # Lint findings scoped to this file only
            file_lint = [
                f for f in lint_findings
                if rel in f.file or f.file == rel or f.file.endswith(f"/{rel}")
            ]

            result = self.review(
                diff=content,
                lint_findings=file_lint,
                repo_path=repo_path,
                review_mode="file",
            )

            if result.is_error:
                # Record error in summary but keep going for remaining files
                summaries.append(f"**`{rel}`** — ⚠ {result.summary}")
                continue

            blocking = blocking or result.blocking
            all_comments.extend(result.file_comments)
            grades.append(result.grade)

            if result.summary and result.summary not in ("(no summary)", "AI review skipped (CD_SKIP_AI=1)"):
                summaries.append(f"**`{rel}`**\n\n{result.summary}")

        if not summaries and not all_comments:
            return ReviewResult.skipped()

        return ReviewResult(
            summary="\n\n---\n\n".join(summaries),
            blocking=blocking,
            file_comments=all_comments,
            grade=worst_grade(grades),
        )

    def review(
        self,
        diff: str,
        lint_findings: list[LintFinding],
        repo_path: Path | None = None,
        review_mode: str = "diff",  # "diff" | "file"
    ) -> ReviewResult:
        settings = load_settings()

        if not self.config.enabled or settings.skip_ai:
            return ReviewResult.skipped()

        # Resolve effective max_tokens: env var (VS Code setting) > config file > built-in default
        max_tokens = self.config.max_tokens
        if settings.cd_max_tokens.strip():
            try:
                max_tokens = int(settings.cd_max_tokens.strip())
            except ValueError:
                pass

        # Load skill guidelines from the repo's .commit-defender directory
        skills_text = _load_skills(repo_path) if repo_path else ""

        # Use the full Config for review_settings fallback; build a default if absent
        from .config import Config as _Config
        full_cfg = self._full_config or _Config()

        system_content = _build_system_prompt(
            settings,
            full_cfg,
            skills_text,
            self.config.system_prompt_suffix,
            review_mode=review_mode,
        )

        findings_text = "\n".join(str(f) for f in lint_findings) if lint_findings else "None"

        if review_mode == "file":
            content_header = "## File contents"
            content_body = diff or "(no content available)"
        else:
            content_header = "## Staged diff"
            content_body = f"```diff\n{diff or '(no diff available)'}\n```"

        user_message = f"""\
{content_header}

{content_body}

## Static analysis findings

```
{findings_text}
```

Please review the above and respond with the JSON object as instructed.
"""

        # Route to the correct provider
        provider = settings.cd_ai_provider.strip().lower() or "azure-openai"
        if provider == "anthropic":
            return self._review_anthropic(settings, system_content, user_message, max_tokens)
        elif provider == "openai":
            return self._review_openai(settings, system_content, user_message, max_tokens)
        else:
            return self._review_azure(settings, system_content, user_message, max_tokens)

    # ── Shared helper: resolve unified connection params ──────────────────────

    def _resolve(self, settings: "Settings", key: str, fallback: str) -> str:
        """Return VS Code override (cd_*) if non-empty, else the env-file fallback."""
        override = getattr(settings, f"cd_{key}", "").strip()
        return override if override else fallback

    # ── Azure OpenAI ──────────────────────────────────────────────────────────

    def _review_azure(
        self,
        settings: "Settings",
        system_content: str,
        user_message: str,
        max_tokens: int,
    ) -> ReviewResult:
        api_key    = self._resolve(settings, "api_key",    settings.azure_openai_api_key)
        endpoint   = self._resolve(settings, "endpoint",   settings.azure_openai_endpoint)
        api_version= self._resolve(settings, "api_version",settings.azure_openai_api_version)
        model      = self._resolve(settings, "model",      settings.azure_openai_deployment or self.config.model)

        missing = [f for f, v in [
            ("AZURE_OPENAI_API_KEY",    api_key),
            ("AZURE_OPENAI_ENDPOINT",   endpoint),
            ("AZURE_OPENAI_DEPLOYMENT", model),
        ] if not v]
        if missing:
            return ReviewResult.error(
                f"Missing Azure OpenAI credentials: {', '.join(missing)}\n"
                f"  Set them in VS Code settings (commitDefender.apiKey / endpoint / model)\n"
                f"  or in ~/.commit-defender.env."
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
            return ReviewResult.error("openai package not installed. Run: pip install openai")

        client = AzureOpenAI(api_key=api_key, azure_endpoint=endpoint, api_version=api_version)

        try:
            try:
                response = client.chat.completions.create(
                    model=model,
                    max_completion_tokens=max_tokens,
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": system_content},
                        {"role": "user", "content": user_message},
                    ],
                )
            except Exception as fmt_err:
                _fmt_msg = str(fmt_err).lower()
                if not any(k in _fmt_msg for k in ("response_format", "json_object", "unsupported")):
                    raise
                response = client.chat.completions.create(
                    model=model,
                    max_completion_tokens=max_tokens,
                    messages=[
                        {"role": "system", "content": system_content},
                        {"role": "user", "content": user_message},
                    ],
                )
            raw = response.choices[0].message.content.strip()
            return self._parse_result(raw, max_tokens)

        except AuthenticationError as e:
            return ReviewResult.error(f"Azure OpenAI authentication failed.\n  Detail: {e.message}")
        except APIConnectionError as e:
            return ReviewResult.error(f"Could not reach Azure OpenAI endpoint '{endpoint}'.\n  Detail: {e}")
        except APITimeoutError:
            return ReviewResult.error(f"Azure OpenAI request timed out (max_tokens={max_tokens}).")
        except RateLimitError as e:
            return ReviewResult.error(f"Azure OpenAI rate limit exceeded.\n  Detail: {e.message}")
        except APIStatusError as e:
            return ReviewResult.error(f"Azure OpenAI HTTP {e.status_code}.\n  Detail: {e.message}")
        except json.JSONDecodeError:
            return self._json_error(max_tokens)
        except Exception as e:
            return ReviewResult.error(f"Unexpected error: {type(e).__name__}: {e}")

    # ── OpenAI (api.openai.com) ───────────────────────────────────────────────

    def _review_openai(
        self,
        settings: "Settings",
        system_content: str,
        user_message: str,
        max_tokens: int,
    ) -> ReviewResult:
        api_key  = self._resolve(settings, "api_key", settings.azure_openai_api_key)
        model    = self._resolve(settings, "model",   self.config.model or "gpt-4o")
        endpoint = self._resolve(settings, "endpoint", "")  # empty = use openai default

        if not api_key:
            return ReviewResult.error(
                "Missing OpenAI API key.\n"
                "  Set commitDefender.apiKey in VS Code settings (User scope)\n"
                "  or add OPENAI_API_KEY to ~/.commit-defender.env."
            )

        try:
            from openai import (
                OpenAI,
                APIConnectionError,
                APIStatusError,
                APITimeoutError,
                AuthenticationError,
                RateLimitError,
            )
        except ImportError:
            return ReviewResult.error("openai package not installed. Run: pip install openai")

        client_kwargs: dict = {"api_key": api_key}
        if endpoint:
            client_kwargs["base_url"] = endpoint
        client = OpenAI(**client_kwargs)

        try:
            try:
                response = client.chat.completions.create(
                    model=model,
                    max_completion_tokens=max_tokens,
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": system_content},
                        {"role": "user", "content": user_message},
                    ],
                )
            except Exception as fmt_err:
                _fmt_msg = str(fmt_err).lower()
                if not any(k in _fmt_msg for k in ("response_format", "json_object", "unsupported")):
                    raise
                response = client.chat.completions.create(
                    model=model,
                    max_completion_tokens=max_tokens,
                    messages=[
                        {"role": "system", "content": system_content},
                        {"role": "user", "content": user_message},
                    ],
                )
            raw = response.choices[0].message.content.strip()
            return self._parse_result(raw, max_tokens)

        except AuthenticationError as e:
            return ReviewResult.error(f"OpenAI authentication failed — check your API key.\n  Detail: {e.message}")
        except APIConnectionError as e:
            return ReviewResult.error(f"Could not reach OpenAI API.\n  Detail: {e}")
        except APITimeoutError:
            return ReviewResult.error(f"OpenAI request timed out (max_tokens={max_tokens}).")
        except RateLimitError as e:
            return ReviewResult.error(f"OpenAI rate limit exceeded.\n  Detail: {e.message}")
        except APIStatusError as e:
            return ReviewResult.error(f"OpenAI HTTP {e.status_code}.\n  Detail: {e.message}")
        except json.JSONDecodeError:
            return self._json_error(max_tokens)
        except Exception as e:
            return ReviewResult.error(f"Unexpected error: {type(e).__name__}: {e}")

    # ── Anthropic ─────────────────────────────────────────────────────────────

    def _review_anthropic(
        self,
        settings: "Settings",
        system_content: str,
        user_message: str,
        max_tokens: int,
    ) -> ReviewResult:
        api_key = self._resolve(settings, "api_key", settings.anthropic_api_key)
        model   = self._resolve(settings, "model",   "claude-sonnet-4-6")

        if not api_key:
            return ReviewResult.error(
                "Missing Anthropic API key.\n"
                "  Set commitDefender.apiKey in VS Code settings (User scope)\n"
                "  or add ANTHROPIC_API_KEY to ~/.commit-defender.env."
            )

        try:
            import anthropic as _anthropic
        except ImportError:
            return ReviewResult.error("anthropic package not installed. Run: pip install anthropic")

        try:
            client = _anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system_content,
                messages=[{"role": "user", "content": user_message}],
            )
            raw = response.content[0].text.strip()
            return self._parse_result(raw, max_tokens)

        except _anthropic.AuthenticationError as e:
            return ReviewResult.error(f"Anthropic authentication failed — check your API key.\n  Detail: {e}")
        except _anthropic.APIConnectionError as e:
            return ReviewResult.error(f"Could not reach Anthropic API.\n  Detail: {e}")
        except _anthropic.RateLimitError as e:
            return ReviewResult.error(f"Anthropic rate limit exceeded.\n  Detail: {e}")
        except _anthropic.APIStatusError as e:
            return ReviewResult.error(f"Anthropic HTTP {e.status_code}.\n  Detail: {e.message}")
        except json.JSONDecodeError:
            return self._json_error(max_tokens)
        except Exception as e:
            return ReviewResult.error(f"Unexpected error: {type(e).__name__}: {e}")

    def _parse_result(self, raw: str, max_tokens: int) -> ReviewResult:
        """Parse the raw model response string into a ReviewResult."""
        try:
            data = _parse_json(raw)
        except json.JSONDecodeError:
            return self._json_error(max_tokens, raw)

        valid_categories = {
            "correctness", "security", "maintenance",
            "optimization", "review-history", "setting",
        }
        file_comments = [
            FileComment(
                file=fc["file"],
                line=int(fc.get("line", 0)),
                comment=fc["comment"],
                category=fc.get("category", "").lower()
                         if fc.get("category", "").lower() in valid_categories
                         else "",
            )
            for fc in data.get("file_comments", [])
            if "file" in fc and "comment" in fc
        ]
        raw_grade = data.get("grade", "").strip().lower()
        grade = raw_grade if raw_grade in {
            "exceptional", "proficient", "adequate", "insufficient", "critical"
        } else ""
        return ReviewResult(
            summary=data.get("summary", "(no summary)"),
            blocking=bool(data.get("blocking", False)),
            raw_response=raw,
            file_comments=file_comments,
            grade=grade,
        )

    def _json_error(self, max_tokens: int, raw: str = "") -> ReviewResult:
        """Log a detailed JSON parse failure and return an error ReviewResult."""
        raw_text = raw or "(none)"
        print(
            f"\n[commit-defender] JSON parse failed. Full model response:\n"
            f"{'─' * 60}\n{raw_text}\n{'─' * 60}\n"
            f"Possible causes:\n"
            f"  1. max_tokens too low — response was truncated mid-JSON\n"
            f"     Fix: increase commitDefender.maxTokens in VS Code settings (current: {max_tokens})\n"
            f"  2. Model does not support JSON output mode\n"
            f"  3. Content filtering — model refused to respond in JSON\n",
            file=sys.stderr, flush=True,
        )
        return ReviewResult.error(
            f"Could not parse AI response as JSON "
            f"(max_tokens={max_tokens}). "
            f"See the output panel for the full model response and fix suggestions."
        )
