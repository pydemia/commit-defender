"""Resolve the final exit code from a Report."""

from .config import Config
from .models import Report


class ExitCodeResolver:
    def __init__(self, config: Config) -> None:
        self.config = config

    def resolve(self, report: Report) -> int:
        """Return 0 (pass) or 1 (block)."""
        # API / infrastructure errors only block when ai_review is a hard gate.
        # When ai_review.blocking=false the review is advisory — a network hiccup
        # must not prevent a commit from landing.
        if report.review.is_error and self.config.ai_review.blocking:
            return 1

        # Lint findings at or above the configured threshold always block.
        blocking_findings = report.findings_at_or_above(self.config.blocking_severity)
        if blocking_findings:
            return 1

        # AI review blocks only when both the config gate and the AI say so.
        if self.config.ai_review.blocking and report.review.blocking:
            return 1

        return 0
