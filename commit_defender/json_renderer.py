"""JSON output renderer for machine consumption (VS Code extension, CI)."""

from __future__ import annotations

import json
import sys

from .models import Report


class JsonRenderer:
    def __init__(self, stream=None) -> None:
        self.stream = stream or sys.stdout

    def render(self, report: Report, exit_code: int, repo_path: str = "/repo") -> None:
        prefix = repo_path.rstrip("/") + "/"

        def rel(path: str) -> str:
            """Strip container-internal repo prefix, leaving a repo-relative path."""
            return path[len(prefix):] if path.startswith(prefix) else path

        payload = {
            "schema_version": 1,
            "staged_files": report.staged_files,
            "duration_ms": report.duration_ms,
            "exit_code": exit_code,
            "lint_findings": [
                {
                    "file": rel(f.file),
                    "line": f.line,
                    "col": f.col,
                    "rule": f.rule,
                    "message": f.message,
                    "severity": f.severity,
                }
                for f in report.lint_findings
            ],
            "review": {
                "summary": report.review.summary,
                "blocking": report.review.blocking,
                "is_error": report.review.is_error,
                "file_comments": [
                    {
                        "file": fc.file,
                        "line": fc.line,
                        "comment": fc.comment,
                    }
                    for fc in report.review.file_comments
                ],
            },
        }

        print(json.dumps(payload, ensure_ascii=False), file=self.stream, flush=True)
