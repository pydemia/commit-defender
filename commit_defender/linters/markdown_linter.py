"""Markdown linter using markdownlint-cli2."""

from __future__ import annotations

import json
import re
from pathlib import Path

from ..models import LintFinding
from .base import BaseLinter


class MarkdownLinter(BaseLinter):
    def run(self, files: list[Path]) -> list[LintFinding]:
        if not self._is_available("markdownlint-cli2"):
            return []

        str_files = [str(f) for f in files]
        # markdownlint-cli2 outputs JSON when --formatter is provided
        result = self._exec(["markdownlint-cli2", "--formatter", "json"] + str_files)

        findings: list[LintFinding] = []
        # markdownlint-cli2 JSON output is an array of objects
        raw = result.stdout.strip() or result.stderr.strip()
        try:
            data = json.loads(raw)
            if not isinstance(data, list):
                data = []
        except json.JSONDecodeError:
            # Fallback: parse text output
            return self._parse_text(result.stdout + result.stderr, files)

        for item in data:
            findings.append(
                LintFinding(
                    file=item.get("fileName", ""),
                    line=item.get("lineNumber", 0),
                    col=0,
                    rule=item.get("ruleNames", ["MD000"])[0],
                    message=item.get("ruleDescription", "") + " " + (item.get("errorDetail") or ""),
                    severity="warning",
                )
            )
        return findings

    def _parse_text(self, output: str, files: list[Path]) -> list[LintFinding]:
        """Fallback text parser for markdownlint output."""
        findings: list[LintFinding] = []
        pattern = re.compile(r"^(.+):(\d+)(?::(\d+))? (MD\d+/\S+) (.+)$")
        for line in output.splitlines():
            m = pattern.match(line.strip())
            if m:
                findings.append(
                    LintFinding(
                        file=m.group(1),
                        line=int(m.group(2)),
                        col=int(m.group(3)) if m.group(3) else 0,
                        rule=m.group(4).split("/")[0],
                        message=m.group(5),
                        severity="warning",
                    )
                )
        return findings
