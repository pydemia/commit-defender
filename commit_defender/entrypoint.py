"""Main entrypoint for commit-defender container."""

from __future__ import annotations

import sys
import time
from pathlib import Path


def run() -> int:
    """Execute the full pre-commit validation pipeline. Returns exit code."""
    from .ai_agent import AIReviewAgent
    from .config import load_config
    from .diff_extractor import DiffExtractor
    from .exit_resolver import ExitCodeResolver
    from .linters import build_linters
    from .models import Report
    from .settings import load_settings
    from .staged_files import StagedFilesReader

    settings = load_settings()
    repo_path = Path(settings.cd_repo_path)
    dry_run = settings.dry_run

    config = load_config(repo_path)

    reader = StagedFilesReader(repo_path, config)
    staged = reader.read()

    if not staged:
        return 0

    start = time.monotonic()

    # Static analysis
    by_lang = reader.by_language(staged)
    lint_findings = []
    for lang, files in by_lang.items():
        linter_cfg = getattr(config.linters, lang, None)
        if linter_cfg is None or not linter_cfg.enabled:
            continue
        linters = build_linters(lang, linter_cfg)
        for linter in linters:
            lint_findings.extend(linter.run(files))

    # Diff extraction
    diff_extractor = DiffExtractor(repo_path)
    full_diff = diff_extractor.get_full_diff(staged)

    # AI review
    ai_agent = AIReviewAgent(config.ai_review)
    review = ai_agent.review(full_diff, lint_findings)

    duration_ms = int((time.monotonic() - start) * 1000)

    report = Report(
        staged_files=[str(f.relative_to(repo_path)) for f in staged],
        lint_findings=lint_findings,
        review=review,
        duration_ms=duration_ms,
    )

    resolver = ExitCodeResolver(config)
    exit_code = resolver.resolve(report) if not dry_run else 0

    # ANSI report always goes to stderr (visible in terminal and hook output)
    from .renderer import ReportRenderer
    ReportRenderer().render(report, blocked=(exit_code == 1))

    # JSON output goes to stdout when requested (consumed by VS Code extension / CI)
    if settings.json_mode:
        from .json_renderer import JsonRenderer
        JsonRenderer().render(report, exit_code, repo_path=str(repo_path))

    return exit_code


def cli() -> None:
    """CLI entry point (used by installer for direct invocation)."""
    sys.exit(run())


if __name__ == "__main__":
    cli()
