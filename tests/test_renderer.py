"""Tests for the report renderer."""

import io

from commit_defender.models import LintFinding, Report, ReviewResult
from commit_defender.renderer import ReportRenderer


def _make_report(findings=None, blocked=False) -> tuple[Report, bool]:
    report = Report(
        staged_files=["main.py", "utils.py"],
        lint_findings=findings or [],
        review=ReviewResult(
            summary="The code has some style issues but is functionally sound.",
            blocking=blocked,
        ),
        duration_ms=312,
    )
    return report, blocked


def test_renderer_pass():
    buf = io.StringIO()
    renderer = ReportRenderer(stream=buf)
    report, blocked = _make_report()
    renderer.render(report, blocked=False)
    output = buf.getvalue()
    assert "COMMIT APPROVED" in output
    assert "2" in output  # staged file count
    assert "312ms" in output


def test_renderer_blocked():
    buf = io.StringIO()
    renderer = ReportRenderer(stream=buf)
    findings = [
        LintFinding(file="main.py", line=5, col=1, rule="E501", message="line too long", severity="error")
    ]
    report, _ = _make_report(findings=findings, blocked=True)
    renderer.render(report, blocked=True)
    output = buf.getvalue()
    assert "COMMIT BLOCKED" in output
    assert "main.py" in output
    assert "E501" in output
    assert "--no-verify" in output


def test_renderer_no_findings():
    buf = io.StringIO()
    renderer = ReportRenderer(stream=buf)
    report, _ = _make_report()
    renderer.render(report, blocked=False)
    output = buf.getvalue()
    assert "No linting issues" in output


def test_renderer_ai_review_shown():
    buf = io.StringIO()
    renderer = ReportRenderer(stream=buf)
    report, _ = _make_report()
    renderer.render(report, blocked=False)
    output = buf.getvalue()
    assert "functionally sound" in output
