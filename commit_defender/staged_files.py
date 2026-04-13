"""Resolve and categorize staged files."""

from __future__ import annotations

import os
from pathlib import Path

import pathspec

from .config import Config


# Map file extension → language key (matches Config.linters keys)
EXT_TO_LANG: dict[str, str] = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".md": "markdown",
    ".markdown": "markdown",
}


class StagedFilesReader:
    def __init__(self, repo_path: Path, config: Config) -> None:
        self.repo_path = repo_path
        self.config = config
        self._exclude_spec = pathspec.PathSpec.from_lines("gitwildmatch", config.exclude)

    def read(self) -> list[Path]:
        """Return list of staged file paths (absolute) that pass exclusion filters."""
        raw = os.environ.get("CD_STAGED_FILES", "")
        if not raw:
            return []

        paths: list[Path] = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            abs_path = self.repo_path / line
            if not abs_path.exists():
                continue
            if self._exclude_spec.match_file(line):
                continue
            paths.append(abs_path)
        return paths

    def by_language(self, files: list[Path]) -> dict[str, list[Path]]:
        """Group files by detected language."""
        result: dict[str, list[Path]] = {}
        for f in files:
            lang = EXT_TO_LANG.get(f.suffix.lower())
            if lang is None:
                continue
            result.setdefault(lang, []).append(f)
        return result
