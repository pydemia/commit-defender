"""Tests for shared data models."""

from commit_defender.models import LintFinding, Report, ReviewResult, SEVERITY_RANK


def _finding(severity: str) -> LintFinding:
    return LintFinding(file="f.py", line=1, col=0, rule="X1", message="msg", severity=severity)


def test_severity_rank_order():
    assert SEVERITY_RANK["error"] > SEVERITY_RANK["warning"] > SEVERITY_RANK["info"]


def test_report_findings_at_or_above():
    report = Report(
        staged_files=["f.py"],
        lint_findings=[
            _finding("info"),
            _finding("warning"),
            _finding("error"),
        ],
        review=ReviewResult.skipped(),
        duration_ms=100,
    )

    assert len(report.findings_at_or_above("error")) == 1
    assert len(report.findings_at_or_above("warning")) == 2
    assert len(report.findings_at_or_above("info")) == 3


def test_review_result_skipped():
    r = ReviewResult.skipped()
    assert r.blocking is False
    assert "skipped" in r.summary.lower()


def test_review_result_error():
    r = ReviewResult.error("API unavailable")
    assert r.blocking is False
    assert "API unavailable" in r.summary


def test_lint_finding_str():
    f = _finding("error")
    s = str(f)
    assert "f.py" in s
    assert "error" in s
    assert "X1" in s
