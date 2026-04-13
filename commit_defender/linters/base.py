"""Abstract base class for all linters."""

from __future__ import annotations

import subprocess
from abc import ABC, abstractmethod
from pathlib import Path

from ..config import LinterConfig
from ..models import LintFinding


class BaseLinter(ABC):
    def __init__(self, config: LinterConfig) -> None:
        self.config = config

    @abstractmethod
    def run(self, files: list[Path]) -> list[LintFinding]:
        """Run linter on the given files and return normalized findings."""
        ...

    def _exec(self, cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
        """Run a subprocess, returning result regardless of exit code."""
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(cwd) if cwd else None,
        )

    def _is_available(self, binary: str) -> bool:
        """Check whether a binary exists on PATH."""
        import shutil
        return shutil.which(binary) is not None
