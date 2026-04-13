"""JavaScript/TypeScript linter using eslint."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from ..models import LintFinding
from .base import BaseLinter

# Minimal embedded eslint flat config for repos without one
_FALLBACK_ESLINT_CONFIG = """\
export default [
  {
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
      "no-console": "warn",
      "eqeqeq": "warn",
      "semi": ["warn", "always"],
    },
  },
];
"""

_ESLINT_SEVERITY_MAP = {0: "info", 1: "warning", 2: "error"}


class JSLinter(BaseLinter):
    def run(self, files: list[Path]) -> list[LintFinding]:
        if not self._is_available("eslint"):
            return []

        str_files = [str(f) for f in files]
        cmd = ["eslint", "--format", "json"]

        # Check if repo has its own eslint config; if not, use embedded fallback
        repo_root = files[0].parent if files else Path.cwd()
        has_config = any(
            (repo_root / name).exists()
            for name in ["eslint.config.js", "eslint.config.mjs", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml"]
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            if not has_config:
                cfg_path = Path(tmpdir) / "eslint.config.mjs"
                cfg_path.write_text(_FALLBACK_ESLINT_CONFIG)
                cmd.extend(["--no-eslintrc", "--config", str(cfg_path)])

            cmd.extend(str_files)
            result = self._exec(cmd)

        findings: list[LintFinding] = []
        try:
            data = json.loads(result.stdout or "[]")
        except json.JSONDecodeError:
            return findings

        for file_result in data:
            filepath = file_result.get("filePath", "")
            for msg in file_result.get("messages", []):
                findings.append(
                    LintFinding(
                        file=filepath,
                        line=msg.get("line", 0),
                        col=msg.get("column", 0),
                        rule=msg.get("ruleId") or "eslint",
                        message=msg.get("message", ""),
                        severity=_ESLINT_SEVERITY_MAP.get(msg.get("severity", 1), "warning"),
                    )
                )
        return findings
