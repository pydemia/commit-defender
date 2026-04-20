"""Extract git diffs for staged files."""

from __future__ import annotations

import subprocess
from pathlib import Path

# Limit diff size sent to AI to avoid token overflow (~100K chars ≈ ~25K tokens)
MAX_DIFF_CHARS = 80_000


class DiffExtractor:
    def __init__(self, repo_path: Path) -> None:
        self.repo_path = repo_path

    def get_full_diff(self, files: list[Path]) -> str:
        """Return combined unified diff for all staged files."""
        if not files:
            return ""

        rel_paths = [str(f.relative_to(self.repo_path)) for f in files]

        # Handle initial commit: no HEAD yet
        try:
            result = self._run_git(["diff", "--cached", "--diff-filter=d", "--"] + rel_paths)
        except subprocess.CalledProcessError:
            # Fallback: diff against empty tree (first commit)
            empty_tree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
            result = self._run_git(["diff", "--cached", "--diff-filter=d", empty_tree, "--"] + rel_paths)

        diff = result.stdout
        if len(diff) > MAX_DIFF_CHARS:
            diff = diff[:MAX_DIFF_CHARS] + "\n\n[... diff truncated for token limit ...]"
        return diff

    def get_file_diff(self, file: Path) -> str:
        """Return unified diff for a single staged file."""
        rel = str(file.relative_to(self.repo_path))
        try:
            result = self._run_git(["diff", "--cached", "--", rel])
            return result.stdout
        except subprocess.CalledProcessError:
            return ""

    def get_file_contents(self, files: list[Path]) -> str:
        """Return full file contents for on-demand review (file / directory commands).

        Unlike get_full_diff(), this reads each file directly regardless of git
        status — so committed files with no pending changes are still fully reviewed.
        Each file is wrapped in a fenced code block with its repo-relative path as
        the header so the AI can reference specific line numbers.
        """
        if not files:
            return ""

        parts: list[str] = []
        for f in files:
            rel = str(f.relative_to(self.repo_path))
            try:
                content = f.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue

            # Detect language hint from extension for the code fence
            ext = f.suffix.lstrip(".")
            parts.append(f"### {rel}\n\n```{ext}\n{content}\n```")

        combined = "\n\n".join(parts)
        if len(combined) > MAX_DIFF_CHARS:
            combined = combined[:MAX_DIFF_CHARS] + "\n\n[... truncated for token limit ...]"
        return combined

    def _run_git(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", "-C", str(self.repo_path)] + args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",  # never crash on non-UTF-8 bytes in diff output
            check=True,
        )
