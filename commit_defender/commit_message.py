"""Commit message generator — uses the same AI providers as the review agent."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .settings import load_settings, Settings


# ── System prompt ─────────────────────────────────────────────────────────────

COMMIT_MESSAGE_SYSTEM_PROMPT = """\
# Git Commit Message Generation Prompt

Construct a commit message consisting of a title and a body

## Title Rules
- Limit title to 50 characters
- Capitalize the first letter
- Avoid periods and special characters
- Start with a base verb
- Exclude past tense
- Use format: [{type}] {title_text}
- Select one type from the list below:
  - Feature: Add new functionality
  - Improve: Refine business logic or performance
  - Fix: Resolve bugs or issues
  - Doc: Update documentation
  - Refactor: Restructure code without changing behavior
  - Test: Add or update test cases
  - Chore: Update build tasks or package managers

## Body Rules
- Limit total text to 300 characters
- Keep each bullet point under 50 characters
- Focus on what and why instead of how
- Provide clear reasons for code changes
- Write in concise bullet points
- Capitalize the first letter of each line
- Avoid periods and special characters
- Exclude past tense
- Start each line with a base verb

## Output Example
[Improve] Refine user authentication logic

- Validate session tokens before database access
- Enhance security by rotating encryption keys
- Reduce latency in login process

## Output Format
Respond ONLY with a valid JSON object — no markdown fences, no extra keys:
{
  "commit_message": "<title>\\n\\n<body>"
}
"""


# ── Result type ───────────────────────────────────────────────────────────────

@dataclass
class CommitMessageResult:
    commit_message: str = ""
    is_error: bool = False
    error: str = ""


# ── Generator ─────────────────────────────────────────────────────────────────

class CommitMessageGenerator:
    """Generate a conventional commit message from a staged diff."""

    def generate(self, diff: str) -> CommitMessageResult:
        settings = load_settings()
        provider = settings.cd_ai_provider.strip().lower() or "aoai"

        # Keep tokens modest — commit messages are short.
        max_tokens = 512
        if settings.cd_max_tokens.strip():
            try:
                max_tokens = min(int(settings.cd_max_tokens.strip()), 512)
            except ValueError:
                pass

        user_message = (
            "Generate a commit message for the following staged diff:\n\n"
            f"```diff\n{diff}\n```"
        )

        if provider == "anthropic":
            return self._call_anthropic(settings, user_message, max_tokens)
        if provider == "openai":
            return self._call_openai(settings, user_message, max_tokens)
        if provider == "gemini":
            return self._call_gemini(settings, user_message, max_tokens)
        return self._call_azure(settings, user_message, max_tokens)

    # ── JSON parsing ──────────────────────────────────────────────────────────

    @staticmethod
    def _parse(raw: str) -> str:
        """Extract commit_message from the model's JSON response."""
        stripped = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
        stripped = re.sub(r"```\s*$", "", stripped.strip(), flags=re.MULTILINE)
        data = json.loads(stripped.strip())
        return data.get("commit_message", "").strip()

    # ── Provider implementations ──────────────────────────────────────────────

    def _call_azure(self, settings: Settings, user_message: str, max_tokens: int) -> CommitMessageResult:
        api_key     = settings.cd_api_key.strip()
        endpoint    = settings.cd_endpoint.strip()
        api_version = settings.cd_api_version.strip() or "2024-08-01-preview"
        model       = settings.cd_model.strip()

        missing = [n for n, v in [("apiKey", api_key), ("endpoint", endpoint), ("model", model)] if not v]
        if missing:
            return CommitMessageResult(is_error=True,
                error=f"Missing Azure OpenAI settings: {', '.join(missing)}")
        try:
            from openai import AzureOpenAI
            client = AzureOpenAI(api_key=api_key, azure_endpoint=endpoint, api_version=api_version)
            try:
                resp = client.chat.completions.create(
                    model=model, max_completion_tokens=max_tokens,
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": COMMIT_MESSAGE_SYSTEM_PROMPT},
                        {"role": "user",   "content": user_message},
                    ],
                )
            except Exception as fmt_err:
                msg = str(fmt_err).lower()
                if not any(k in msg for k in ("response_format", "json_object", "unsupported")):
                    raise
                resp = client.chat.completions.create(
                    model=model, max_completion_tokens=max_tokens,
                    messages=[
                        {"role": "system", "content": COMMIT_MESSAGE_SYSTEM_PROMPT},
                        {"role": "user",   "content": user_message},
                    ],
                )
            return CommitMessageResult(self._parse(resp.choices[0].message.content.strip()))
        except Exception as e:
            return CommitMessageResult(is_error=True, error=str(e))

    def _call_openai(self, settings: Settings, user_message: str, max_tokens: int) -> CommitMessageResult:
        api_key  = settings.cd_api_key.strip()
        model    = settings.cd_model.strip() or "gpt-4o"
        endpoint = settings.cd_endpoint.strip()
        if not api_key:
            return CommitMessageResult(is_error=True, error="Missing OpenAI API key")
        try:
            from openai import OpenAI
            kwargs: dict = {"api_key": api_key}
            if endpoint:
                kwargs["base_url"] = endpoint
            client = OpenAI(**kwargs)
            try:
                resp = client.chat.completions.create(
                    model=model, max_completion_tokens=max_tokens,
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": COMMIT_MESSAGE_SYSTEM_PROMPT},
                        {"role": "user",   "content": user_message},
                    ],
                )
            except Exception as fmt_err:
                msg = str(fmt_err).lower()
                if not any(k in msg for k in ("response_format", "json_object", "unsupported")):
                    raise
                resp = client.chat.completions.create(
                    model=model, max_completion_tokens=max_tokens,
                    messages=[
                        {"role": "system", "content": COMMIT_MESSAGE_SYSTEM_PROMPT},
                        {"role": "user",   "content": user_message},
                    ],
                )
            return CommitMessageResult(self._parse(resp.choices[0].message.content.strip()))
        except Exception as e:
            return CommitMessageResult(is_error=True, error=str(e))

    def _call_anthropic(self, settings: Settings, user_message: str, max_tokens: int) -> CommitMessageResult:
        api_key = settings.cd_api_key.strip()
        model   = settings.cd_model.strip() or "claude-sonnet-4-6"
        if not api_key:
            return CommitMessageResult(is_error=True, error="Missing Anthropic API key")
        try:
            import anthropic as _anthropic
            client = _anthropic.Anthropic(api_key=api_key)
            resp = client.messages.create(
                model=model, max_tokens=max_tokens,
                system=COMMIT_MESSAGE_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_message}],
            )
            return CommitMessageResult(self._parse(resp.content[0].text.strip()))
        except Exception as e:
            return CommitMessageResult(is_error=True, error=str(e))

    def _call_gemini(self, settings: Settings, user_message: str, max_tokens: int) -> CommitMessageResult:
        api_key = settings.cd_api_key.strip()
        model   = settings.cd_model.strip() or "gemini-2.5-flash"
        if not api_key:
            return CommitMessageResult(is_error=True, error="Missing Gemini API key")
        try:
            from google import genai
            from google.genai import types as genai_types
            client = genai.Client(api_key=api_key)
            resp = client.models.generate_content(
                model=model,
                contents=user_message,
                config=genai_types.GenerateContentConfig(
                    system_instruction=COMMIT_MESSAGE_SYSTEM_PROMPT,
                    max_output_tokens=max_tokens,
                    response_mime_type="application/json",
                ),
            )
            return CommitMessageResult(self._parse(resp.text.strip()))
        except Exception as e:
            return CommitMessageResult(is_error=True, error=str(e))


# ── Entrypoint ────────────────────────────────────────────────────────────────

def run_commit_message() -> int:
    """Generate a commit message for the current staged diff; write JSON to stdout."""
    settings = load_settings()
    repo_path = Path(settings.repo_path)

    print(
        f"[commit-defender] commit-message mode  repo={repo_path}",
        file=sys.stderr, flush=True,
    )

    try:
        proc = subprocess.run(
            ["git", "diff", "--cached"],
            cwd=str(repo_path),
            capture_output=True, text=True, timeout=30,
        )
        diff = proc.stdout.strip()
    except Exception as e:
        _out({"commit_message": "", "is_error": True, "error": f"git diff failed: {e}"})
        return 1

    if not diff:
        _out({"commit_message": "", "is_error": True, "error": "No staged changes found."})
        return 1

    result = CommitMessageGenerator().generate(diff)
    _out({
        "commit_message": result.commit_message,
        "is_error": result.is_error,
        "error": result.error,
    })
    return 1 if result.is_error else 0


def _out(payload: dict) -> None:
    print(json.dumps(payload), flush=True)
