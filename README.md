commit-defender — Complete Blueprint Implemented
What was created (50 files)
Python package commit_defender/

models.py — shared LintFinding, ReviewResult, Report dataclasses
config.py — Pydantic-validated YAML loader with defaults
staged_files.py — reads CD_STAGED_FILES, routes by language, respects exclude patterns
diff_extractor.py — git diff --cached against the mounted repo, handles initial commits + truncation
ai_agent.py — Anthropic SDK with prompt caching on system prompt, JSON structured output, offline escape hatch
renderer.py — ANSI-colored terminal report written to stderr
exit_resolver.py — decides exit 0/1 based on severity thresholds
entrypoint.py — pipeline orchestrator
linters/ — ruff, eslint, shellcheck, markdownlint-cli2 wrappers (JSON output, graceful if binary missing)
Infrastructure

Dockerfile — multi-stage build (python builder → node tools → final slim image)
docker-compose.yml — local dev + test runner
commit-defender.yaml — annotated config reference
Installer

installer/hook_template.sh — the actual git hook script
installer/install.py — install / uninstall CLI
Tests — tests/ with fixtures and unit tests for config, models, linters, renderer, and AI agent (mocked).

8 Skills files in .claude/skills/ covering every module in depth.

Quick start

# 1. Build the image
docker build -t commit-defender:latest .

# 2. Install the hook into any repo
python -m installer.install install /path/to/your-repo

# 3. Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# 4. Stage files and commit — defender runs automatically
git add . && git commit -m "my changes"