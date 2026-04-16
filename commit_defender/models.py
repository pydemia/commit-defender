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


@dataclass
class FileComment:
    file: str       # repo-relative path
    line: int       # 1-based; 0 = file-level comment
    comment: str
    category: str = ""  # correctness | security | maintenance | optimization | review-history | setting


@dataclass
class ReviewResult:
    summary: str
    findings: list[LintFinding] = field(default_factory=list)
    blocking: bool = False
    raw_response: str = ""
    is_error: bool = False  # True when review failed (always blocks commit)
    file_comments: list[FileComment] = field(default_factory=list)
    grade: str = ""

    @classmethod
    def skipped(cls) -> "ReviewResult":
        return cls(summary="AI review skipped (CD_SKIP_AI=1)", blocking=False, is_error=False)

    @classmethod
    def error(cls, message: str) -> "ReviewResult":
        return cls(
            summary=f"AI review unavailable: {message}",
            blocking=True,
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
