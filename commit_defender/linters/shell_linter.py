"""Shell script linter using shellcheck."""

from __future__ import annotations

import json
from pathlib import Path

from ..models import LintFinding
from .base import BaseLinter

_SC_LEVEL_MAP = {"error": "error", "warning": "warning", "info": "info", "style": "info"}


class ShellLinter(BaseLinter):
    def run(self, files: list[Path]) -> list[LintFinding]:
        if not self._is_available("shellcheck"):
            return []

        str_files = [str(f) for f in files]
        result = self._exec(["shellcheck", "--format=json"] + str_files)

        findings: list[LintFinding] = []
        try:
            data = json.loads(result.stdout or "[]")
        except json.JSONDecodeError:
            return findings

        for item in data:
            findings.append(
                LintFinding(
                    file=item.get("file", ""),
                    line=item.get("line", 0),
                    col=item.get("column", 0),
                    rule=f"SC{item.get('code', '')}",
                    message=item.get("message", ""),
                    severity=_SC_LEVEL_MAP.get(item.get("level", "warning"), "warning"),
                )
            )
        return findings
