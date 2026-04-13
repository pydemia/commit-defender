"""Linter module — factory and exports."""

from __future__ import annotations

from pathlib import Path

from ..config import LinterConfig
from .base import BaseLinter
from .js_linter import JSLinter
from .markdown_linter import MarkdownLinter
from .python_linter import PythonLinter
from .shell_linter import ShellLinter

_LINTER_CLASSES: dict[str, type[BaseLinter]] = {
    "python": PythonLinter,
    "javascript": JSLinter,
    "typescript": JSLinter,
    "shell": ShellLinter,
    "markdown": MarkdownLinter,
}


def build_linters(lang: str, config: LinterConfig) -> list[BaseLinter]:
    """Return linter instance(s) for the given language."""
    cls = _LINTER_CLASSES.get(lang)
    if cls is None:
        return []
    return [cls(config)]
