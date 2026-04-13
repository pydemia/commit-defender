"""Resolve the final exit code from a Report."""

from .config import Config
from .models import Report


class ExitCodeResolver:
    def __init__(self, config: Config) -> None:
        self.config = config

    def resolve(self, report: Report) -> int:
        """Return 0 (pass) or 1 (block)."""
        blocking_findings = report.findings_at_or_above(self.config.blocking_severity)
        if blocking_findings:
            return 1

        if self.config.ai_review.blocking and report.review.blocking:
            return 1

        return 0
