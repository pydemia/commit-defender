"""Shared data models for commit-defender."""

from dataclasses import dataclass, field
from typing import Literal


Severity = Literal["error", "warning", "info"]

SEVERITY_RANK: dict[str, int] = {"error": 3, "warning": 2, "info": 1}

VALID_GRADES = ("exceptional", "proficient", "adequate", "insufficient", "critical")
GRADE_RANK: dict[str, int] = {
    "exceptional": 5, "proficient": 4, "adequate": 3, "insufficient": 2, "critical": 1,
}


def worst_grade(grades: list[str]) -> str:
    """Return the worst grade from a list, ignoring empty/invalid entries."""
    valid = [g for g in grades if g in GRADE_RANK]
    if not valid:
        return ""
    return min(valid, key=lambda g: GRADE_RANK[g])


@dataclass
class LintFinding:
    file: str
    line: int
    col: int
    rule: str
    message: str
    severity: Severity

    def __str__(self) -> str:
        return f"{self.file}:{self.line}:{self.col} [{self.severity}] {self.rule}: {self.message}"


PRIORITY_RANK: dict[str, int] = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
PRIORITY_LABEL: dict[str, str] = {
    "P0": "Praise",
    "P1": "Info",
    "P2": "Warning",
    "P3": "Critical",
}
PRIORITY_EMOJI: dict[str, str] = {
    "P0": "🟩",
    "P1": "🟦",
    "P2": "🟧",
    "P3": "🟥",
}


@dataclass
class FileComment:
    file: str       # repo-relative path
    line: int       # 1-based; 0 = file-level comment
    comment: str
    category: str = ""   # correctness | security | maintenance | optimization | review-history | setting
    priority: str = "P1" # P0=Praise | P1=Nitpick | P2=Suggestion | P3=Critical


@dataclass
class PerFileSummary:
    """Per-file overall-summary emitted by review_files_separately().

    One entry per analyzed file. Carries the structured data the webview
    needs to render an overall-summary block with a representative
    priority badge, without having to parse the concatenated `summary`
    markdown back apart on delimiters.
    """
    file: str
    summary: str
    priority: str = "P1"   # representative priority across this file's unit-comment-blocks
    blocking: bool = False
    grade: str = ""


@dataclass
class ReviewResult:
    summary: str
    findings: list[LintFinding] = field(default_factory=list)
    blocking: bool = False
    raw_response: str = ""
    is_error: bool = False  # True when review failed (always blocks commit)
    file_comments: list[FileComment] = field(default_factory=list)
    grade: str = ""
    per_file_summaries: list[PerFileSummary] = field(default_factory=list)

    @classmethod
    def skipped(cls) -> "ReviewResult":
        return cls(summary="AI review skipped (CD_SKIP_AI=1)", blocking=False, is_error=False)

    @classmethod
    def error(cls, message: str) -> "ReviewResult":
        return cls(
            summary=f"AI review unavailable: {message}",
            blocking=False,  # ExitCodeResolver gates on ai_review.blocking config; errors are advisory
            is_error=True,
        )


@dataclass
class Report:
    staged_files: list[str]
    lint_findings: list[LintFinding]
    review: ReviewResult
    duration_ms: int

    def findings_at_or_above(self, severity: Severity) -> list[LintFinding]:
        threshold = SEVERITY_RANK[severity]
        return [f for f in self.lint_findings if SEVERITY_RANK[f.severity] >= threshold]
