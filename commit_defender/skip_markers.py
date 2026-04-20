"""Inline skip directives — fully suppress findings on marked lines.

Supported markers (applied to the line they appear on):
  # CD:skip              — suppress all findings on this line
  # CD:skip:<reason>     — suppress all findings; <reason> is a human note
  # type: ignore         — suppress all findings on this line
  # TODO                 — suppress all findings on this line
"""

from __future__ import annotations

import re
from pathlib import Path

from .models import FileComment, LintFinding

_CD_SKIP     = re.compile(r'#\s*CD\s*:\s*skip', re.IGNORECASE)
_TYPE_IGNORE = re.compile(r'#\s*type\s*:\s*ignore')
_TODO        = re.compile(r'#\s*TODO\b', re.IGNORECASE)


def _is_marked(line: str) -> bool:
    return bool(_CD_SKIP.search(line) or _TYPE_IGNORE.search(line) or _TODO.search(line))


def scan_file(path: Path) -> set[int]:
    """Return the set of 1-based line numbers that carry a skip marker."""
    marked: set[int] = set()
    try:
        lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
    except OSError:
        return marked
    for i, line in enumerate(lines, start=1):
        if _is_marked(line):
            marked.add(i)
    return marked


def apply_markers(
    file_comments: list[FileComment],
    lint_findings: list[LintFinding],
    staged: list[Path],
    repo_path: Path,
) -> tuple[list[FileComment], list[LintFinding]]:
    """Remove all findings whose line carries a skip marker."""

    # Build skip-line sets keyed by repo-relative path string
    skip_map: dict[str, set[int]] = {}
    for p in staged:
        try:
            rel = str(p.relative_to(repo_path))
        except ValueError:
            rel = str(p)
        marked = scan_file(p)
        if marked:
            skip_map[rel] = marked

    if not skip_map:
        return file_comments, lint_findings

    new_comments = [
        fc for fc in file_comments
        if fc.line not in skip_map.get(fc.file, set())
    ]
    new_lint = [
        lf for lf in lint_findings
        if lf.line not in skip_map.get(lf.file, set())
    ]
    return new_comments, new_lint
