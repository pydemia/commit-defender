"""Resolve and categorize files for analysis."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pathspec

from .config import Config
from .settings import Settings


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

# Binary / media file extensions that are never useful to diff or review.
# These are skipped before any path-existence or exclude-pattern checks.
BINARY_EXTENSIONS: frozenset[str] = frozenset({
    # Images
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp", ".tiff", ".tif",
    ".heic", ".heif", ".avif",
    # Video / audio
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv",
    ".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a",
    # Archives / packages
    ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
    ".jar", ".war", ".ear",
    ".vsix", ".whl", ".egg",
    # Compiled / binary
    ".pyc", ".pyo", ".pyd",
    ".class", ".so", ".dll", ".dylib", ".exe", ".bin", ".o", ".a",
    ".wasm",
    # Fonts
    ".ttf", ".otf", ".woff", ".woff2", ".eot",
    # Documents
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    # Database / data blobs
    ".db", ".sqlite", ".sqlite3",
    ".parquet", ".arrow", ".avro", ".pkl", ".pickle", ".npy", ".npz",
    # Lock / generated manifests handled by pattern excludes, but add common ones
    ".lock",
})


class StagedFilesReader:
    def __init__(self, repo_path: Path, config: Config, settings: Settings | None = None) -> None:
        self.repo_path = repo_path
        self.config = config

        # Merge: commit-defender.yaml → settings.json → VS Code setting (CD_EXCLUDE_PATTERNS)
        combined_patterns = (
            list(config.exclude)
            + list(config.review_settings.excludePatterns)
        )
        if settings and settings.cd_exclude_patterns.strip():
            vscode_patterns = [
                p.strip()
                for p in settings.cd_exclude_patterns.splitlines()
                if p.strip()
            ]
            combined_patterns.extend(vscode_patterns)

        self._exclude_spec = pathspec.PathSpec.from_lines("gitwildmatch", combined_patterns)

    def read(self) -> list[Path]:
        """Return files to analyze, excluding patterns.

        Source priority:
          1. CD_TARGET_FILES — explicit list from "analyze file/directory" command
          2. CD_STAGED_FILES — git-staged files from the pre-commit hook
        """
        raw = os.environ.get("CD_TARGET_FILES", "") or os.environ.get("CD_STAGED_FILES", "")
        if not raw:
            return []

        return self._resolve(raw)

    def read_explicit(self, file_lines: str) -> list[Path]:
        """Resolve an explicit newline-separated list of repo-relative paths."""
        return self._resolve(file_lines)

    def _resolve(self, raw: str) -> list[Path]:
        paths: list[Path] = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue

            # Skip binary / media files — diffing them is meaningless
            suffix = Path(line).suffix.lower()
            if suffix in BINARY_EXTENSIONS:
                print(f"[commit-defender] skip (binary): {line}", file=sys.stderr, flush=True)
                continue

            abs_path = self.repo_path / line
            if not abs_path.exists():
                print(f"[commit-defender] skip (not found): {abs_path}", file=sys.stderr, flush=True)
                continue
            if self._exclude_spec.match_file(line):
                print(f"[commit-defender] skip (excluded): {line}", file=sys.stderr, flush=True)
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
