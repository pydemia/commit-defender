"""Format the analysis report for terminal output."""

from __future__ import annotations

import sys
from collections import defaultdict

from .models import LintFinding, Report, SEVERITY_RANK

# ANSI escape codes — no external dependency
RESET = "\033[0m"
BOLD = "\033[1m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
GREEN = "\033[32m"
DIM = "\033[2m"
BG_RED = "\033[41m"
BG_GREEN = "\033[42m"


def _color(text: str, *codes: str) -> str:
    return "".join(codes) + text + RESET


def _severity_color(severity: str) -> str:
    return {
        "error": RED,
        "warning": YELLOW,
        "info": CYAN,
    }.get(severity, RESET)


class ReportRenderer:
    def __init__(self, stream=None) -> None:
        # Always write to stderr so git doesn't swallow output
        self.stream = stream or sys.stderr

    def render(self, report: Report, blocked: bool) -> None:
        lines: list[str] = []

        lines.append("")
        lines.append(_color(" commit-defender ", BOLD, BG_RED if blocked else BG_GREEN) + "  " + _color("pre-commit analysis", BOLD))
        lines.append(_color("─" * 60, DIM))

        # Staged files summary
        lines.append(f"  {_color('Staged files:', BOLD)} {len(report.staged_files)}")
        lines.append(f"  {_color('Duration:', BOLD)} {report.duration_ms}ms")
        lines.append("")

        # Lint findings grouped by file
        if report.lint_findings:
            by_file: dict[str, list[LintFinding]] = defaultdict(list)
            for f in sorted(report.lint_findings, key=lambda x: (x.file, x.line)):
                by_file[f.file].append(f)

            lines.append(_color("  Linting Issues", BOLD))
            lines.append(_color("  " + "─" * 40, DIM))

            for filepath, findings in sorted(by_file.items()):
                lines.append(f"  {_color(filepath, BOLD, CYAN)}")
                for finding in findings:
                    sev_col = _severity_color(finding.severity)
                    badge = _color(f" {finding.severity.upper()} ", BOLD, sev_col)
                    location = _color(f"{finding.line}:{finding.col}", DIM)
                    rule = _color(finding.rule, DIM)
                    lines.append(f"    {badge} {location}  {rule}  {finding.message}")
                lines.append("")
        else:
            lines.append(_color("  No linting issues found.", GREEN))
            lines.append("")

        # AI review
        lines.append(_color("  AI Review", BOLD))
        lines.append(_color("  " + "─" * 40, DIM))
        if report.review.summary:
            for review_line in report.review.summary.splitlines():
                lines.append(f"  {review_line}")
        lines.append("")

        # Final verdict
        if blocked:
            lines.append(_color("  COMMIT BLOCKED ", BOLD, BG_RED))
            lines.append(f"  {_color('Fix the issues above and re-commit.', BOLD)}")
            lines.append(f"  {_color('To skip checks (not recommended): git commit --no-verify', DIM)}")
        else:
            lines.append(_color("  COMMIT APPROVED ", BOLD, BG_GREEN))

        lines.append("")

        print("\n".join(lines), file=self.stream)
