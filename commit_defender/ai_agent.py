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
        "Apply the strictest possible review. Flag every deviation from best practice, "
        "every style inconsistency, every potential issue no matter how minor. "
        "Use all priority levels: P3 (Critical), P2 (Warning), P1 (Info), and P0 (Praise). "
        "Zero tolerance — emit as many findings as warranted."
    ),
    "rigorous": (
        "Apply a strict review. Flag most issues including minor style and best-practice deviations. "
        "Use P3, P2, and P1. Include P0 Praise only for genuinely exemplary code. "
        "Err on the side of raising concerns."
    ),
    "moderate": (
        "Apply a balanced review. Flag meaningful issues and genuine best-practice violations. "
        "Use P3 and P2 freely. Limit P1 Info to at most 2 per file — only the most impactful optional improvements. "
        "Do not emit P0 Praise unless every aspect of the file is truly exemplary. "
        "Do not nitpick trivial style details."
    ),
    "generous": (
        "Apply a lenient review. Only flag issues with clear, concrete risk. "
        "Use P3 (Critical) and P2 (Warning) only — do NOT emit P1 Info or P0 Praise. "
        "Allow minor imperfections and style deviations without comment."
    ),
    "lean": (
        "Apply a minimal review. ONLY flag P3 Critical issues: broken functionality, "
        "security vulnerabilities, or data loss risk. "
        "Do NOT emit P2, P1, or P0 findings under any circumstances. "
        "If there are no P3 issues, return an empty file_comments array."
    ),
}

# Minimum priority level that may appear in output, per severity setting.
# Comments below this level are dropped from the result after AI parsing.
_SEVERITY_MIN_PRIORITY: dict[str, int] = {
    # Priority rank: P3=3 (highest urgency), P2=2, P1=1, P0=0
    "lean":      3,  # P3 only
    "generous":  2,  # P2 and P3
    "moderate":  1,  # P1, P2, P3
    "rigorous":  1,  # P1, P2, P3
    "severe":    0,  # all (P0 Praise included)
}

_PRIORITY_RANK: dict[str, int] = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}

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
      "priority": "<one of: P0 | P1 | P2 | P3>",
      "comment": "<actionable suggestion, markdown allowed>"
    }"""

_BASE_SYSTEM_PROMPT_DIFF = f"""\
You are commit-defender, an AI code reviewer integrated into a git pre-commit hook.

You run AFTER a static linter. The linter has already identified errors (P3) and warnings (P2).
Your job has two parts:
1. **Linter-flagged code** — confirm, synthesize, and contextualize linter findings. Do not downgrade their priority.
2. **Clean code** — act as the final checker for code the linter passed. Look for logic errors, security issues, and architectural problems the linter cannot detect.

## Review categories
Every file comment must be tagged with one of these categories:
- **correctness** — logic errors, type issues, null/undefined safety, off-by-one, missing tests
- **security** — secrets, injection, broken auth, crypto weaknesses, OWASP Top 10
- **maintenance** — readability, naming, code conventions, structure, comments
- **optimization** — performance, complexity, N+1 queries, memory leaks
- **review-history** — recurring review patterns, MR best practices, knowledge transfer
- **setting** — env vars, secrets management, deployment config, infrastructure safety

## Acceptance level (priority)
Every comment requires a "priority" field. Before choosing a level, run through the P3 gate first.

### STEP 1 — P3 gate (check this before anything else)
Assign **P3 Critical 🟥** if the issue falls into ANY of these categories — no exceptions, no downgrading to P2 or P1:
- Syntax error or incomplete statement (e.g. `from module im`, `def foo(`, missing colon, truncated expression)
- Import that will raise `ImportError` or `SyntaxError` at parse time
- Undefined variable, missing required argument, wrong number of arguments
- Security vulnerability: hardcoded secret, SQL/command injection, broken auth, path traversal
- Data-loss risk: unguarded `DELETE`, file overwrite without backup, destructive operation without confirmation
- Runtime crash that is certain to occur (not "might" — will)
- Any finding from static analysis that is classified as an **error** (not warning, not info)

If ANY of the above applies, the priority is **P3**. Do not reassign to P2 or P1 for any reason. Move to the next comment.

### STEP 2 — remaining levels (only when P3 does not apply)
- **P2** Warning 🟧 — Code runs but carries real risk: potential (not certain) runtime errors, deprecated APIs, poor error handling, bad performance patterns, maintainability problems likely to cause future bugs. Highly recommended to fix.
- **P1** Info 🟦 — Code is syntactically valid, logically correct, and the linter raised NO error or warning for it. Purely optional improvement: better naming, cleaner structure, readability. **Never assign P1 to code that has a linter error, a syntax problem, or any runtime risk.**
- **P0** Praise 🟩 — Positive feedback ONLY. Use at file level (line 0) when the code is genuinely clean with nothing to flag. Never mix praise with a concern.

## Code quality grade
Assign ONE grade that reflects the overall quality of the reviewed code:
- **exceptional** — Exemplary code. Clean, secure, well-structured. Best practices throughout. No significant issues.
- **proficient** — Good code. Minor issues only; nothing blocking.
- **adequate** — Acceptable code. Notable issues that should be fixed but are not blocking.
- **insufficient** — Significant problems that need addressing before this can be considered ready.
- **critical** — Severe issues: security vulnerabilities, data-loss risk, or logic-breaking bugs. Must not be committed as-is.

## Inline skip directives
If any of these markers appear on a line, do not emit any finding for that line — omit it entirely from `file_comments`:
- `# CD:skip` — developer explicitly suppresses review for this line
- `# CD:skip:<reason>` — same suppression; the reason is a human note, not a condition
- `# type: ignore` — intentional type-checker suppression; skip this line
- `# TODO` — known unfinished work; skip this line

## Core guidelines
- Be direct and specific. Reference file names and line numbers.
- Group related issues together.
- Do not repeat every lint finding verbatim — synthesize patterns and highlight the most important ones.
- If the changes look good overall, say so clearly with a P0 Praise comment.

## Output format
Respond ONLY with a valid JSON object matching this schema:
{{
  "summary": "<narrative review, markdown allowed>",
  "blocking": <true if any P3 comment exists, false otherwise>,
  "grade": "<one of: exceptional | proficient | adequate | insufficient | critical>",
  "file_comments": [
{_COMMENT_SCHEMA}
  ]
}}

Rules for file_comments:
- Only reference lines that appear in the provided diff.
- Limit to at most 15 comments total.
- Every comment must include both "category" and "priority" fields.
- Omit the array (or use []) if there is nothing specific to annotate.
- Do not include anything outside the JSON object.
"""

_BASE_SYSTEM_PROMPT_FILE = f"""\
You are commit-defender, an AI code reviewer.

You run AFTER a static linter. The linter has already identified errors (P3) and warnings (P2).
Your job has two parts:
1. **Linter-flagged code** — confirm, synthesize, and contextualize linter findings. Do not downgrade their priority.
2. **Clean code** — act as the final checker for code the linter passed. Look for logic errors, security issues, and architectural problems the linter cannot detect.

## Review categories
Every file comment must be tagged with one of these categories:
- **correctness** — logic errors, type issues, null/undefined safety, off-by-one, missing tests
- **security** — secrets, injection, broken auth, crypto weaknesses, OWASP Top 10
- **maintenance** — readability, naming, code conventions, structure, comments
- **optimization** — performance, complexity, N+1 queries, memory leaks
- **review-history** — recurring review patterns, MR best practices, knowledge transfer
- **setting** — env vars, secrets management, deployment config, infrastructure safety

## Acceptance level (priority)
Every comment requires a "priority" field. Before choosing a level, run through the P3 gate first.

### STEP 1 — P3 gate (check this before anything else)
Assign **P3 Critical 🟥** if the issue falls into ANY of these categories — no exceptions, no downgrading to P2 or P1:
- Syntax error or incomplete statement (e.g. `from module im`, `def foo(`, missing colon, truncated expression)
- Import that will raise `ImportError` or `SyntaxError` at parse time
- Undefined variable, missing required argument, wrong number of arguments
- Security vulnerability: hardcoded secret, SQL/command injection, broken auth, path traversal
- Data-loss risk: unguarded `DELETE`, file overwrite without backup, destructive operation without confirmation
- Runtime crash that is certain to occur (not "might" — will)
- Any finding from static analysis that is classified as an **error** (not warning, not info)

If ANY of the above applies, the priority is **P3**. Do not reassign to P2 or P1 for any reason. Move to the next comment.

### STEP 2 — remaining levels (only when P3 does not apply)
- **P2** Warning 🟧 — Code runs but carries real risk: potential (not certain) runtime errors, deprecated APIs, poor error handling, bad performance patterns, maintainability problems likely to cause future bugs. Highly recommended to fix.
- **P1** Info 🟦 — Code is syntactically valid, logically correct, and the linter raised NO error or warning for it. Purely optional improvement: better naming, cleaner structure, readability. **Never assign P1 to code that has a linter error, a syntax problem, or any runtime risk.**
- **P0** Praise 🟩 — Positive feedback ONLY. Use at file level (line 0) when the code is genuinely clean with nothing to flag. Never mix praise with a concern.

## Code quality grade
Assign ONE grade that reflects the overall quality of the reviewed code:
- **exceptional** — Exemplary code. Clean, secure, well-structured. Best practices throughout. No significant issues.
- **proficient** — Good code. Minor issues only; nothing blocking.
- **adequate** — Acceptable code. Notable issues that should be fixed but are not blocking.
- **insufficient** — Significant problems that need addressing before this can be considered ready.
- **critical** — Severe issues: security vulnerabilities, data-loss risk, or logic-breaking bugs. Must not be committed as-is.

## Inline skip directives
If any of these markers appear on a line, do not emit any finding for that line — omit it entirely from `file_comments`:
- `# CD:skip` — developer explicitly suppresses review for this line
- `# CD:skip:<reason>` — same suppression; the reason is a human note, not a condition
- `# type: ignore` — intentional type-checker suppression; skip this line
- `# TODO` — known unfinished work; skip this line

## Core guidelines
- Be direct and specific. Reference file names and exact line numbers.
- Group related issues together.
- Do not repeat every lint finding verbatim — synthesize patterns and highlight important ones.
- If the code looks good overall, say so clearly with a P0 Praise comment.

## Output format
Respond ONLY with a valid JSON object matching this schema:
{{
  "summary": "<narrative review, markdown allowed>",
  "blocking": <true if any P3 comment exists, false otherwise>,
  "grade": "<one of: exceptional | proficient | adequate | insufficient | critical>",
  "file_comments": [
{_COMMENT_SCHEMA}
  ]
}}

Rules for file_comments:
- You may reference any line number in the file — not limited to changed lines.
- Limit to at most 20 comments total across all files.
- Every comment must include both "category" and "priority" fields.
- Omit the array (or use []) if there is nothing specific to annotate.
- Do not include anything outside the JSON object.
"""


def _build_lint_section(lint_findings: list) -> str:
    """Build the static-analysis section of the user message.

    Errors become P3 Critical, warnings become P2 Warning, info becomes P1 Info.
    Files with no findings are listed separately so the AI knows to apply its
    deep review there.
    """
    from .models import PRIORITY_LABEL, PRIORITY_EMOJI

    sev_to_priority = {"error": "P3", "warning": "P2", "info": "P1"}

    if not lint_findings:
        return (
            "## Static analysis findings\n\n"
            "No linter issues found. Apply thorough AI review to all code as the final checker."
        )

    errors   = [f for f in lint_findings if f.severity == "error"]
    warnings = [f for f in lint_findings if f.severity == "warning"]
    infos    = [f for f in lint_findings if f.severity == "info"]

    lines: list[str] = [
        "## Static analysis findings",
        "",
        "These issues were identified by the linter BEFORE the AI review.",
        "Treat linter errors as P3 Critical and linter warnings as P2 Warning — do not downgrade them.",
        "Your role: synthesize these into actionable comments and perform deep review on code the linter did not flag.",
        "",
    ]

    if errors:
        lines.append(f"### 🟥 P3 Critical — linter errors ({len(errors)})")
        for f in errors:
            lines.append(f"  {f.file}:{f.line}:{f.col}  [{f.rule}]  {f.message}")
        lines.append("")

    if warnings:
        lines.append(f"### 🟧 P2 Warning — linter warnings ({len(warnings)})")
        for f in warnings:
            lines.append(f"  {f.file}:{f.line}:{f.col}  [{f.rule}]  {f.message}")
        lines.append("")

    if infos:
        lines.append(f"### 🟦 P1 Info — linter info ({len(infos)})")
        for f in infos:
            lines.append(f"  {f.file}:{f.line}:{f.col}  [{f.rule}]  {f.message}")
        lines.append("")

    # Summarise which files are clean so the AI knows where to focus deep review
    flagged_files = {f.file for f in lint_findings}
    lines.append(
        "### Deep review scope\n"
        "Apply thorough AI review (logic, security, architecture) to ALL code. "
        "For linter-flagged lines, confirm and contextualize. "
        "For clean lines not flagged above, act as the final checker."
    )

    return "\n".join(lines)


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

    severity = settings.cd_severity_level.strip().lower() or "moderate"
    richness = settings.cd_richness_level.strip().lower() or "moderate"
    locale   = settings.cd_locale.strip().lower()          or "en"

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
    """Parse JSON from the model response.

    Tries strategies in order:
    1. Direct parse.
    2. Strip markdown fences (```json ... ```).
    3. Find the first complete top-level {...} block.
    4. Repair truncated JSON by closing open brackets/strings.
    """
    def _try(text: str) -> dict | None:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None

    # 1. Direct parse
    result = _try(raw)
    if result is not None:
        return result

    # 2. Strip markdown fences
    stripped = re.sub(r'^```(?:json)?\s*', '', raw.strip(), flags=re.MULTILINE)
    stripped = re.sub(r'```\s*$', '', stripped.strip(), flags=re.MULTILINE)
    result = _try(stripped.strip())
    if result is not None:
        return result

    # 3. Find first complete {...} block
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
                result = _try(raw[start:i + 1])
                if result is not None:
                    return result
                start = None

    # 4. Repair truncated JSON — find the opening brace and close all open
    #    brackets/braces/strings so the parser can recover partial content.
    open_idx = raw.find('{')
    if open_idx != -1:
        repaired = _repair_truncated_json(raw[open_idx:])
        result = _try(repaired)
        if result is not None:
            return result

    raise json.JSONDecodeError("No valid JSON found in response", raw, 0)


def _repair_truncated_json(text: str) -> str:
    """Best-effort repair of a truncated JSON string.

    Walks the text tracking open braces, brackets, and strings.
    Appends whatever closing tokens are needed to make it valid.
    The result may have empty/null values where content was cut off.
    """
    stack: list[str] = []
    in_string = False
    escape_next = False

    for ch in text:
        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"':
            if in_string:
                in_string = False
            else:
                in_string = True
            continue
        if in_string:
            continue
        if ch in ('{', '['):
            stack.append(ch)
        elif ch == '}' and stack and stack[-1] == '{':
            stack.pop()
        elif ch == ']' and stack and stack[-1] == '[':
            stack.pop()

    # Close any open string first
    suffix = '"' if in_string else ''
    # Close open containers in reverse order
    for token in reversed(stack):
        suffix += '}' if token == '{' else ']'

    return text + suffix


# ── Priority enforcement ──────────────────────────────────────────────────────

# Keywords that signal the comment describes a P3-level issue regardless of
# what the model assigned. Matched case-insensitively against the comment text.
_P3_PATTERNS = re.compile(
    r"syntax error|syntaxerror"
    r"|import error|importerror"
    r"|parse error|cannot be parsed|fails to parse|파싱"
    r"|undefined variable|nameerror|attributeerror"
    r"|cannot be executed|won't run|will not run|실행.*불가|불가.*실행"
    r"|incomplete (import|statement|expression|syntax)"
    r"|missing (colon|parenthes|bracket|quote)"
    r"|security (vulnerabilit|risk|flaw)|취약|injection|secret.*expos|hardcoded.*(key|secret|password|token)"
    r"|data.?loss|data.?corrupt|unrecoverable"
    r"|문법 오류|구문 오류|임포트 오류",
    re.IGNORECASE,
)

def _enforce_priority(assigned: str, comment_text: str) -> str:
    """Upgrade to P3 when the comment text describes an inherently critical issue,
    regardless of what the model assigned."""
    if assigned == "P3":
        return "P3"
    if _P3_PATTERNS.search(comment_text):
        return "P3"
    return assigned


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

        from .models import PerFileSummary

        extractor = DiffExtractor(repo_path or Path("."))
        all_comments: list[FileComment] = []
        per_file: list[PerFileSummary] = []
        summaries: list[str] = []          # flat markdown — kept for terminal renderer
        grades: list[str] = []
        blocking = False
        total = len(files)

        def _meaningful(s: str) -> bool:
            return bool(s) and s not in ("(no summary)", "AI review skipped (CD_SKIP_AI=1)")

        for idx, file_path in enumerate(files, start=1):
            rel = str(file_path.relative_to(repo_path)) if repo_path else str(file_path)
            print(
                f"[commit-defender] AI review {idx}/{total}: {rel}",
                file=sys.stderr, flush=True,
            )

            content = extractor.get_file_contents([file_path])
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
                err_text = f"⚠ {result.summary}"
                summaries.append(f"**`{rel}`** — {err_text}")
                per_file.append(PerFileSummary(
                    file=rel, summary=err_text, priority="P3",
                    blocking=False, grade=result.grade,
                ))
                continue

            blocking = blocking or result.blocking
            all_comments.extend(result.file_comments)

            # Representative priority for this file = worst of its file_comments,
            # falling back to a priority derived from blocking/grade when the AI
            # returned none.
            if result.file_comments:
                file_priority = max(
                    (fc.priority for fc in result.file_comments),
                    key=lambda p: _PRIORITY_RANK.get(p, 1),
                )
            else:
                file_priority = (
                    "P3" if result.blocking
                    else "P2" if result.grade in ("critical", "insufficient")
                    else "P1"
                )

            # Synthesise a line-1 FileComment when the AI returned only prose, so
            # every file has at least one unit-comment-block on the editor.
            if not result.file_comments and _meaningful(result.summary):
                all_comments.append(FileComment(
                    file=rel, line=1, comment=result.summary,
                    category="", priority=file_priority,
                ))

            grades.append(result.grade)

            if _meaningful(result.summary):
                summaries.append(f"**`{rel}`**\n\n{result.summary}")
                per_file.append(PerFileSummary(
                    file=rel, summary=result.summary, priority=file_priority,
                    blocking=result.blocking, grade=result.grade,
                ))

        if not summaries and not all_comments:
            return ReviewResult.skipped()

        if not all_comments and not grades:
            err = ReviewResult.error("\n\n---\n\n".join(summaries))
            err.per_file_summaries = per_file
            return err

        return ReviewResult(
            summary="\n\n---\n\n".join(summaries),
            blocking=blocking,
            file_comments=all_comments,
            grade=worst_grade(grades),
            per_file_summaries=per_file,
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

        if review_mode == "file":
            content_header = "## File contents"
            content_body = diff or "(no content available)"
        else:
            content_header = "## Staged diff"
            content_body = f"```diff\n{diff or '(no diff available)'}\n```"

        lint_section = _build_lint_section(lint_findings)

        user_message = f"""\
{content_header}

{content_body}

{lint_section}

Please review the above and respond with the JSON object as instructed.
"""

        # Route to the correct provider
        provider = settings.cd_ai_provider.strip().lower() or "aoai"
        if provider == "anthropic":
            result = self._review_anthropic(settings, system_content, user_message, max_tokens, lint_findings)
        elif provider == "openai":
            result = self._review_openai(settings, system_content, user_message, max_tokens, lint_findings)
        elif provider == "gemini":
            result = self._review_gemini(settings, system_content, user_message, max_tokens, lint_findings)
        else:
            result = self._review_azure(settings, system_content, user_message, max_tokens, lint_findings)

        # Hard-filter file_comments by severity level — the AI may still return
        # lower-priority findings despite the prompt; this is the enforcement gate.
        severity = settings.cd_severity_level.strip().lower() or "moderate"
        min_rank = _SEVERITY_MIN_PRIORITY.get(severity, 1)
        if not result.is_error:
            if min_rank > 0:
                result.file_comments = [
                    fc for fc in result.file_comments
                    if _PRIORITY_RANK.get(fc.priority, 1) >= min_rank
                ]
            # moderate: cap P1 Info at 2 per file so it doesn't drown out P2/P3
            if severity == "moderate":
                p1_count: dict[str, int] = {}
                filtered = []
                for fc in result.file_comments:
                    if fc.priority == "P1":
                        p1_count[fc.file] = p1_count.get(fc.file, 0) + 1
                        if p1_count[fc.file] > 2:
                            continue
                    filtered.append(fc)
                result.file_comments = filtered

        return result

    @staticmethod
    def _ctx(provider: str, model: str = "", endpoint: str = "", api_version: str = "") -> str:
        """Return a one-line config context string (no API key)."""
        parts = [f"provider={provider}"]
        if model:       parts.append(f"model={model}")
        if endpoint:    parts.append(f"endpoint={endpoint}")
        if api_version: parts.append(f"api_version={api_version}")
        return "  Config: " + ", ".join(parts)

    # ── Azure OpenAI ──────────────────────────────────────────────────────────

    def _review_azure(
        self,
        settings: "Settings",
        system_content: str,
        user_message: str,
        max_tokens: int,
        lint_findings: "list[LintFinding] | None" = None,
    ) -> ReviewResult:
        api_key     = settings.cd_api_key.strip()
        endpoint    = settings.cd_endpoint.strip()
        api_version = settings.cd_api_version.strip() or "2024-08-01-preview"
        model       = settings.cd_model.strip() or self.config.model

        ctx = self._ctx("aoai", model=model, endpoint=endpoint, api_version=api_version)
        missing = [s for s, v in [
            ("commitDefender.apiKey",    api_key),
            ("commitDefender.endpoint",  endpoint),
            ("commitDefender.model",     model),
        ] if not v]
        if missing:
            return ReviewResult.error(
                f"Missing Azure OpenAI settings: {', '.join(missing)}\n{ctx}"
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
            return self._parse_result(raw, max_tokens, lint_findings)

        except AuthenticationError as e:
            return ReviewResult.error(f"Azure OpenAI authentication failed.\n  Detail: {e.message}\n{ctx}")
        except APIConnectionError as e:
            return ReviewResult.error(f"Could not reach Azure OpenAI endpoint.\n  Detail: {e}\n{ctx}")
        except APITimeoutError:
            return ReviewResult.error(f"Azure OpenAI request timed out (max_tokens={max_tokens}).\n{ctx}")
        except RateLimitError as e:
            return ReviewResult.error(f"Azure OpenAI rate limit exceeded.\n  Detail: {e.message}\n{ctx}")
        except APIStatusError as e:
            return ReviewResult.error(f"Azure OpenAI HTTP {e.status_code}.\n  Detail: {e.message}\n{ctx}")
        except json.JSONDecodeError:
            return self._json_error(max_tokens)
        except Exception as e:
            return ReviewResult.error(f"Unexpected error: {type(e).__name__}: {e}\n{ctx}")

    # ── OpenAI (api.openai.com) ───────────────────────────────────────────────

    def _review_openai(
        self,
        settings: "Settings",
        system_content: str,
        user_message: str,
        max_tokens: int,
        lint_findings: "list[LintFinding] | None" = None,
    ) -> ReviewResult:
        api_key  = settings.cd_api_key.strip()
        model    = settings.cd_model.strip() or self.config.model or "gpt-4o"
        endpoint = settings.cd_endpoint.strip()
        ctx = self._ctx("openai", model=model, endpoint=endpoint)

        if not api_key:
            return ReviewResult.error(
                f"Missing OpenAI API key. Set commitDefender.apiKey in VS Code settings (User scope).\n{ctx}"
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
            return self._parse_result(raw, max_tokens, lint_findings)

        except AuthenticationError as e:
            return ReviewResult.error(f"OpenAI authentication failed — check your API key.\n  Detail: {e.message}\n{ctx}")
        except APIConnectionError as e:
            return ReviewResult.error(f"Could not reach OpenAI API.\n  Detail: {e}\n{ctx}")
        except APITimeoutError:
            return ReviewResult.error(f"OpenAI request timed out (max_tokens={max_tokens}).\n{ctx}")
        except RateLimitError as e:
            return ReviewResult.error(f"OpenAI rate limit exceeded.\n  Detail: {e.message}\n{ctx}")
        except APIStatusError as e:
            return ReviewResult.error(f"OpenAI HTTP {e.status_code}.\n  Detail: {e.message}\n{ctx}")
        except json.JSONDecodeError:
            return self._json_error(max_tokens)
        except Exception as e:
            return ReviewResult.error(f"Unexpected error: {type(e).__name__}: {e}\n{ctx}")

    # ── Anthropic ─────────────────────────────────────────────────────────────

    def _review_anthropic(
        self,
        settings: "Settings",
        system_content: str,
        user_message: str,
        max_tokens: int,
        lint_findings: "list[LintFinding] | None" = None,
    ) -> ReviewResult:
        api_key = settings.cd_api_key.strip()
        model   = settings.cd_model.strip() or "claude-sonnet-4-6"
        ctx = self._ctx("anthropic", model=model)

        if not api_key:
            return ReviewResult.error(
                f"Missing Anthropic API key. Set commitDefender.apiKey in VS Code settings (User scope).\n{ctx}"
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
            return self._parse_result(raw, max_tokens, lint_findings)

        except _anthropic.AuthenticationError as e:
            return ReviewResult.error(f"Anthropic authentication failed — check your API key.\n  Detail: {e}\n{ctx}")
        except _anthropic.APIConnectionError as e:
            return ReviewResult.error(f"Could not reach Anthropic API.\n  Detail: {e}\n{ctx}")
        except _anthropic.RateLimitError as e:
            return ReviewResult.error(f"Anthropic rate limit exceeded.\n  Detail: {e}\n{ctx}")
        except _anthropic.APIStatusError as e:
            return ReviewResult.error(f"Anthropic HTTP {e.status_code}.\n  Detail: {e.message}\n{ctx}")
        except json.JSONDecodeError:
            return self._json_error(max_tokens)
        except Exception as e:
            return ReviewResult.error(f"Unexpected error: {type(e).__name__}: {e}\n{ctx}")

    # ── Google Gemini ─────────────────────────────────────────────────────────

    def _review_gemini(
        self,
        settings: "Settings",
        system_content: str,
        user_message: str,
        max_tokens: int,
        lint_findings: "list[LintFinding] | None" = None,
    ) -> ReviewResult:
        api_key = settings.cd_api_key.strip()
        model   = settings.cd_model.strip() or "gemini-2.5-flash"
        ctx = self._ctx("gemini", model=model)

        if not api_key:
            return ReviewResult.error(
                f"Missing Gemini API key. Set commitDefender.apiKey in VS Code settings (User scope).\n{ctx}"
            )

        try:
            from google import genai
            from google.genai import types as genai_types
        except ImportError:
            return ReviewResult.error(
                "google-genai package not installed. Run: pip install google-genai"
            )

        try:
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=model,
                contents=user_message,
                config=genai_types.GenerateContentConfig(
                    system_instruction=system_content,
                    max_output_tokens=max_tokens,
                    response_mime_type="application/json",
                ),
            )
            raw = response.text.strip()
            return self._parse_result(raw, max_tokens, lint_findings)

        except Exception as e:
            # google-genai surfaces errors through google.api_core.exceptions;
            # catch broadly and inspect the message for actionable hints.
            msg = str(e)
            if "API_KEY" in msg or "api key" in msg.lower() or "401" in msg or "403" in msg:
                return ReviewResult.error(
                    f"Gemini authentication failed — check your API key.\n  Detail: {msg}\n{ctx}"
                )
            if "429" in msg or "quota" in msg.lower() or "rate" in msg.lower():
                return ReviewResult.error(
                    f"Gemini rate limit or quota exceeded — try again later.\n  Detail: {msg}\n{ctx}"
                )
            if "404" in msg or "not found" in msg.lower():
                return ReviewResult.error(
                    f"Gemini model not found — check commitDefender.model.\n  Detail: {msg}\n{ctx}"
                )
            return ReviewResult.error(f"Gemini error: {type(e).__name__}: {msg}\n{ctx}")

    def _parse_result(
        self,
        raw: str,
        max_tokens: int,
        lint_findings: "list[LintFinding] | None" = None,
    ) -> ReviewResult:
        """Parse the raw model response string into a ReviewResult."""
        truncated = False
        try:
            data = _parse_json(raw)
        except json.JSONDecodeError:
            return self._json_error(max_tokens, raw)

        # Heuristic: if the raw text doesn't end with '}' (ignoring whitespace/fences),
        # the response was likely truncated and we recovered only partial data.
        clean_end = raw.rstrip().rstrip('`').rstrip()
        if not clean_end.endswith('}'):
            truncated = True

        # Build lookup structures from linter results so we can enforce
        # minimum priority without relying on text pattern matching.
        #   files_with_error  → file had at least one linter error  → AI comment ≥ P3
        #   files_with_warning → file had at least one linter warning → AI comment ≥ P2
        #   error_lines → (normalised_file, line) pairs with a linter error → that line ≥ P3
        #
        # Paths are normalised: we store both the raw path and the basename so that
        # absolute lint paths (/repo/app.py) match relative AI comment paths (app.py).
        lint_findings = lint_findings or []
        files_with_error:   set[str] = set()
        files_with_warning: set[str] = set()
        error_lines:        set[tuple[str, int]] = set()

        def _norm_paths(p: str) -> list[str]:
            from pathlib import Path as _P
            pp = _P(p)
            parts = pp.parts
            variants = [str(_P(*parts[i:])) for i in range(len(parts))]
            return list(dict.fromkeys([p] + variants))

        for lf in lint_findings:
            for np in _norm_paths(lf.file):
                if lf.severity == "error":
                    files_with_error.add(np)
                    error_lines.add((np, lf.line))
                elif lf.severity == "warning":
                    files_with_warning.add(np)

        valid_categories = {
            "correctness", "security", "maintenance",
            "optimization", "review-history", "setting",
        }
        valid_priorities = {"P0", "P1", "P2", "P3"}

        def _resolve_priority(fc: dict) -> str:
            raw_p = fc.get("priority", "P1").upper()
            p = raw_p if raw_p in valid_priorities else "P1"
            # 1. Text-pattern enforcement (catches AI comments that name the error)
            p = _enforce_priority(p, fc.get("comment", ""))
            # 2. Structural enforcement based on linter results.
            #    Normalise AI comment file path the same way lint paths were normalised.
            file = fc.get("file", "")
            line = int(fc.get("line", 0))
            file_variants = _norm_paths(file)
            on_error_line  = any((fv, line) in error_lines    for fv in file_variants)
            in_error_file  = any(fv in files_with_error       for fv in file_variants)
            in_warning_file = any(fv in files_with_warning    for fv in file_variants)
            if on_error_line:
                p = "P3"
            elif in_error_file and p in ("P0", "P1"):
                p = "P2"
            elif in_warning_file and p == "P1":
                p = "P2"
            return p

        file_comments = [
            FileComment(
                file=fc["file"],
                line=int(fc.get("line", 0)),
                comment=fc["comment"],
                category=fc.get("category", "").lower()
                         if fc.get("category", "").lower() in valid_categories
                         else "",
                priority=_resolve_priority(fc),
            )
            for fc in data.get("file_comments", [])
            if "file" in fc and "comment" in fc
        ]

        raw_grade = data.get("grade", "").strip().lower()
        grade = raw_grade if raw_grade in {
            "exceptional", "proficient", "adequate", "insufficient", "critical"
        } else ""

        summary = data.get("summary", "(no summary)")
        if truncated:
            print(
                f"[commit-defender] Warning: AI response was truncated "
                f"(max_tokens={max_tokens}). Partial results recovered. "
                f"Increase commitDefender.maxTokens to get the full review.",
                file=sys.stderr, flush=True,
            )
            summary = (
                f"⚠ Response truncated (max_tokens={max_tokens}) — "
                f"increase `commitDefender.maxTokens` for a complete review.\n\n"
                + summary
            )

        return ReviewResult(
            summary=summary,
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
