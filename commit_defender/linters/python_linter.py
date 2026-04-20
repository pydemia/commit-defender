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
        # Always run built-in AST syntax check first — no external tools needed.
        findings: list[LintFinding] = self._ast_syntax_check(files)
        syntax_error_files = {f.file for f in findings}

        if not self._is_available("ruff"):
            return findings

        str_files = [str(f) for f in files]
        base_args = ["ruff", "check", "--output-format", "json"]
        if self.config.args:
            base_args.extend(self.config.args)
        else:
            base_args.extend(["--select", "E,W,F,I"])

        result = self._exec(base_args + str_files)

        try:
            data = json.loads(result.stdout or "[]")
        except json.JSONDecodeError:
            return findings

        for item in data:
            loc = item.get("location", {})
            filename = item.get("filename", "")
            code = item.get("code", "")
            # Skip ruff E999 duplicates — AST check already captured the syntax error.
            if code == "E999" and filename in syntax_error_files:
                continue
            findings.append(
                LintFinding(
                    file=filename,
                    line=loc.get("row", 0),
                    col=loc.get("column", 0),
                    rule=code,
                    message=item.get("message", ""),
                    severity=_severity_from_code(code),
                )
            )
        return findings

    def _ast_syntax_check(self, files: list[Path]) -> list[LintFinding]:
        """Use Python's built-in ast.parse() to detect syntax errors.

        This runs regardless of whether ruff is installed and guarantees
        that syntax errors are always reported as severity='error'.
        """
        import ast

        findings: list[LintFinding] = []
        for path in files:
            if path.suffix != ".py":
                continue
            try:
                source = path.read_text(encoding="utf-8", errors="replace")
                ast.parse(source, filename=str(path))
            except SyntaxError as exc:
                findings.append(LintFinding(
                    file=str(path),
                    line=exc.lineno or 0,
                    col=exc.offset or 0,
                    rule="E999",
                    message=f"SyntaxError: {exc.msg}",
                    severity="error",
                ))
            except Exception:
                pass
        return findings
