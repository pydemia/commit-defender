"""Main entrypoint for commit-defender container."""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path


def run() -> int:
    """Execute the full pre-commit validation pipeline. Returns exit code."""

    # ── Early diagnostics — printed before any heavy imports ──────────────────
    # These appear in the VS Code output channel so users can debug path issues.
    cd_repo  = os.environ.get("CD_REPO_PATH", "(not set — will use cwd)")
    cd_files = os.environ.get("CD_TARGET_FILES") or os.environ.get("CD_STAGED_FILES") or "(not set)"
    cd_json  = os.environ.get("CD_JSON", "0")
    file_count = len([l for l in cd_files.splitlines() if l.strip()]) if cd_files != "(not set)" else 0
    print(
        f"[commit-defender] repo={cd_repo}  files={file_count}  json={cd_json}",
        file=sys.stderr, flush=True,
    )

    from .ai_agent import AIReviewAgent
    from .config import load_config
    from .diff_extractor import DiffExtractor
    from .exit_resolver import ExitCodeResolver
    from .linters import build_linters
    from .models import Report
    from .settings import load_settings
    from .staged_files import StagedFilesReader

    settings = load_settings()
    repo_path = Path(settings.repo_path)
    dry_run = settings.dry_run

    print(
        f"[commit-defender] settings:"
        f"  provider={settings.cd_ai_provider or '(not set)'},"
        f"  model={settings.cd_model or '(not set)'},"
        f"  endpoint={settings.cd_endpoint or '(not set)'},"
        f"  api_version={settings.cd_api_version or '(not set)'},"
        f"  api_key={'(set, ' + str(len(settings.cd_api_key)) + ' chars)' if settings.cd_api_key else '(NOT SET)'},"
        f"  mode={settings.cd_analysis_mode or '(not set)'}",
        file=sys.stderr, flush=True,
    )

    config = load_config(repo_path)

    reader = StagedFilesReader(repo_path, config, settings)
    staged = reader.read()

    if not staged:
        target_src = "CD_TARGET_FILES" if settings.cd_target_files else "CD_STAGED_FILES"
        print(
            f"[commit-defender] No files matched for analysis "
            f"(repo={repo_path}, source={target_src}).",
            file=sys.stderr, flush=True,
        )
        if settings.json_mode:
            from .json_renderer import JsonRenderer
            from .models import ReviewResult
            empty_report = Report(
                staged_files=[],
                lint_findings=[],
                review=ReviewResult(summary="No files matched for analysis."),
                duration_ms=0,
            )
            JsonRenderer().render(empty_report, exit_code=0, repo_path=str(repo_path))
        return 0

    # ── Many-files guard (interactive / hook mode only; VS Code handles this itself) ──
    if not settings.json_mode:
        on_demand_early = bool(settings.cd_target_files)
        try:
            threshold = int(
                (settings.cd_repo_analysis_warn_threshold if on_demand_early else settings.cd_staged_files_warn_threshold)
                or ("80" if on_demand_early else "20")
            )
        except ValueError:
            threshold = 80 if on_demand_early else 20

        if threshold > 0 and len(staged) > threshold:
            action = settings.cd_many_files_action.strip().lower()
            if not action:
                print(
                    f"\n⚠  commit-defender: {len(staged)} files are staged.\n"
                    "  Analyzing this many files may take a while.\n"
                    "  [1] Proceed to analyze  [2] Skip  [3] Abort commit",
                    file=sys.stderr, flush=True,
                )
                try:
                    choice = input("  Choose (1/2/3) [default: 1]: ").strip()
                except (EOFError, KeyboardInterrupt):
                    choice = "3"
                if choice == "2":
                    action = "skip"
                elif choice == "3":
                    action = "abort"
                else:
                    action = "proceed"

            if action == "skip":
                print("[commit-defender] Analysis skipped.", file=sys.stderr, flush=True)
                return 0
            if action == "abort":
                print("[commit-defender] Commit aborted.", file=sys.stderr, flush=True)
                return 1
            # "proceed" → fall through

    # Resolve analysis mode: env var > default
    mode = settings.cd_analysis_mode.strip() or "hybrid"
    run_linters = mode in ("hybrid", "rule-based")
    run_ai      = mode in ("hybrid", "ai-powered")

    start = time.monotonic()

    # Static analysis (skipped in ai-powered mode)
    lint_findings = []
    if run_linters:
        by_lang = reader.by_language(staged)
        for lang, files in by_lang.items():
            linter_cfg = getattr(config.linters, lang, None)
            if linter_cfg is None or not linter_cfg.enabled:
                continue
            linters = build_linters(lang, linter_cfg)
            for linter in linters:
                lint_findings.extend(linter.run(files))

    # Content extraction:
    #   on-demand (CD_TARGET_FILES) → full file contents, any line is reviewable
    #   pre-commit (CD_STAGED_FILES) → git diff of staged changes only
    diff_extractor = DiffExtractor(repo_path)
    on_demand = bool(settings.cd_target_files)

    # AI review (skipped in rule-based mode)
    if run_ai:
        ai_agent = AIReviewAgent(config.ai_review, full_config=config)

        if on_demand:
            # Per-file looped inference: one AI call per file.
            # Avoids max_tokens truncation — each call only carries one file's
            # content instead of concatenating everything into one giant prompt.
            review = ai_agent.review_files_separately(
                staged, lint_findings, repo_path=repo_path
            )
        else:
            # Pre-commit diff mode: send the combined staged diff in one call.
            # Diffs are usually small; cross-file context is valuable here.
            full_diff = diff_extractor.get_full_diff(staged)
            review = ai_agent.review(
                full_diff, lint_findings, repo_path=repo_path, review_mode="diff"
            )
    else:
        from .models import ReviewResult
        review = ReviewResult(summary="AI review disabled (rule-based mode).", blocking=False)

    duration_ms = int((time.monotonic() - start) * 1000)

    # Apply inline skip directives (# CD:skip, # type: ignore, # TODO)
    from .skip_markers import apply_markers
    review.file_comments, lint_findings = apply_markers(
        review.file_comments, lint_findings, staged, repo_path
    )

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
    """CLI entry point: commit-defender [install|uninstall|<run>]."""
    # Sub-commands: install / uninstall are handled by the installer module.
    if len(sys.argv) > 1 and sys.argv[1] in ("install", "uninstall"):
        from installer.install import main as _installer_main
        _installer_main(sys.argv[1:])
        return

    json_mode = os.environ.get("CD_JSON", "0").strip() == "1"
    try:
        sys.exit(run())
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover
        # Unhandled crash — always emit JSON so the VS Code extension gets a
        # parseable response instead of the silent "No JSON output" error.
        print(f"[commit-defender] Fatal error: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        if json_mode:
            import json as _json
            payload = {
                "schema_version": 1, "staged_files": [], "duration_ms": 0, "exit_code": 1,
                "lint_findings": [],
                "review": {
                    "summary": f"commit-defender crashed: {type(exc).__name__}: {exc}",
                    "blocking": False, "is_error": True, "file_comments": [],
                },
            }
            print(_json.dumps(payload), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    cli()
