"""Python linter using ruff."""

from __future__ import annotations

import json
from pathlib import Path

from ..models import LintFinding
from .base import BaseLinter

# ruff severity mapping
_RUFF_TYPE_MAP: dict[str, str] = {
    "E": "error",
    "W": "warning",
    "F": "error",
    "I": "warning",
    "C": "warning",
    "N": "info",
    "D": "info",
    "UP": "info",
    "B": "warning",
    "A": "warning",
    "S": "warning",
    "T": "info",
}


def _severity_from_code(code: str) -> str:
    prefix = "".join(c for c in code if c.isalpha())
    return _RUFF_TYPE_MAP.get(prefix, "warning")


class PythonLinter(BaseLinter):
    def run(self, files: list[Path]) -> list[LintFinding]:
        if not self._is_available("ruff"):
            return []

        str_files = [str(f) for f in files]
        base_args = ["ruff", "check", "--output-format", "json"]
        if self.config.args:
            base_args.extend(self.config.args)
        else:
            base_args.extend(["--select", "E,W,F,I"])

        result = self._exec(base_args + str_files)

        findings: list[LintFinding] = []
        try:
            data = json.loads(result.stdout or "[]")
        except json.JSONDecodeError:
            return findings

        for item in data:
            loc = item.get("location", {})
            findings.append(
                LintFinding(
                    file=item.get("filename", ""),
                    line=loc.get("row", 0),
                    col=loc.get("column", 0),
                    rule=item.get("code", ""),
                    message=item.get("message", ""),
                    severity=_severity_from_code(item.get("code", "")),
                )
            )
        return findings
