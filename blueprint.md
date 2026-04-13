# commit-defender — Architecture Blueprint & Build Plan

## Context

The user wants to build `commit-defender`: a Python-based AI agent that runs as a git pre-commit hook, validates staged code changes (linting, syntax, conventions), calls the Claude API for an AI review, and interrupts the commit with a human-readable report so the developer can fix issues before the commit lands.

The tool must work as a self-contained Docker container — no dependency on host Python, Node, or any linter being pre-installed. The only host requirement is `docker` and the `ANTHROPIC_API_KEY` environment variable.

---

## Architecture Flow

```
git commit
    │
    ▼
.git/hooks/pre-commit  (shell script, installed once per repo)
    │  1. collect staged files: git diff --cached --name-only --diff-filter=ACMR
    │  2. docker run --rm \
    │       -v "$(git rev-parse --show-toplevel):/repo:ro" \
    │       -e ANTHROPIC_API_KEY \
    │       -e CD_STAGED_FILES="<newline-separated paths>" \
    │       commit-defender:latest  1>&2
    │
    ▼
Docker container (commit-defender image)
    │
    ├─► ConfigLoader        reads /repo/commit-defender.yaml (or defaults)
    ├─► StagedFilesReader   resolves staged paths, routes by language
    ├─► DiffExtractor       git diff --cached per file against /repo/.git
    ├─► LinterRunner        ruff / eslint / shellcheck / markdownlint → LintFindings
    ├─► AIReviewAgent       Claude API: diff + findings → ReviewResult
    ├─► ReportRenderer      formats ANSI terminal report to stderr
    └─► ExitCodeResolver    exit 0 (pass) or exit 1 (blocked)
    │
    ▼
git: exit 1 = commit aborted, user fixes and re-commits
     exit 0 = commit proceeds
```

---

## Directory Structure

```
commit-defender/
├── .claude/
│   └── skills/
│       ├── 01-project-bootstrap.md
│       ├── 02-docker-setup.md
│       ├── 03-static-analysis.md
│       ├── 04-diff-extraction.md
│       ├── 05-ai-review-agent.md
│       ├── 06-report-renderer.md
│       ├── 07-hook-installer.md
│       └── 08-configuration.md
│
├── commit_defender/
│   ├── __init__.py
│   ├── entrypoint.py          # CLI entry, orchestrates full pipeline
│   ├── config.py              # ConfigLoader: reads commit-defender.yaml
│   ├── staged_files.py        # StagedFilesReader: resolves + routes files
│   ├── diff_extractor.py      # DiffExtractor: git diff --cached per file
│   ├── models.py              # LintFinding, ReviewResult, Report dataclasses
│   ├── ai_agent.py            # AIReviewAgent: Anthropic SDK integration
│   ├── renderer.py            # ReportRenderer: ANSI terminal output
│   ├── exit_resolver.py       # ExitCodeResolver: decides exit code
│   └── linters/
│       ├── __init__.py
│       ├── base.py            # abstract BaseLinter
│       ├── python_linter.py   # ruff --output-format json
│       ├── js_linter.py       # eslint --format json
│       ├── shell_linter.py    # shellcheck --format=json
│       └── markdown_linter.py # markdownlint-cli2 --formatter json
│
├── installer/
│   ├── install.py             # installs hook into target repo
│   └── hook_template.sh       # shell script template for pre-commit hook
│
├── tests/
│   ├── fixtures/
│   │   ├── sample_python_dirty.py
│   │   ├── sample_js_dirty.js
│   │   └── sample_diff.txt
│   ├── test_config.py
│   ├── test_linters.py
│   ├── test_ai_agent.py
│   └── test_renderer.py
│
├── Dockerfile                 # multi-stage: python + node tools + shellcheck
├── docker-compose.yml         # for local dev/testing
├── commit-defender.yaml       # default config (lives in target repo)
├── pyproject.toml             # uv-managed, defines commit_defender package
├── CLAUDE.md
├── LICENSE
└── .gitignore
```

---

## Technology Choices

| Concern | Tool | Rationale |
|---|---|---|
| Python linting | `ruff` | Single binary, replaces flake8/pylint/isort, JSON output, sub-second |
| JS/TS linting | `eslint` v9 flat config | De facto standard, JSON output, embedded fallback config |
| Shell linting | `shellcheck` | Single binary, apt-installable, JSON output |
| Markdown | `markdownlint-cli2` | Lightweight, JSON output |
| AI model | `claude-sonnet-4-6` | Fast, capable, configurable in yaml |
| Container base | `python:3.12-slim-bookworm` | Slim Debian, multi-stage to keep final image lean |
| Package mgr | `uv` | Fast, lockfile-based, good Docker layer caching |
| Config format | YAML + Pydantic | Human-readable, validated at load time |
| Exclude patterns | `pathspec` | gitignore syntax matching |

---

## Key Component Details

### `models.py` — Shared Data Model

```python
@dataclass
class LintFinding:
    file: str; line: int; col: int
    rule: str; message: str; severity: str  # "error" | "warning" | "info"

@dataclass
class ReviewResult:
    summary: str; findings: list[LintFinding]
    blocking: bool; raw_response: str

@dataclass
class Report:
    staged_files: list[str]; lint_findings: list[LintFinding]
    review: ReviewResult; duration_ms: int
```

### `ai_agent.py` — Claude API Integration

- Uses `anthropic` Python SDK (prompt caching on system prompt)
- System prompt: static role definition (cached, reduces latency/cost)
- User message: `<diff>` + `<lint_findings>` → asks for JSON ReviewResult
- Env var `CD_SKIP_AI=1` skips AI call (offline/CI mode)
- Model configurable via `commit-defender.yaml` (default: `claude-sonnet-4-6`)

### `installer/hook_template.sh`

```sh
#!/usr/bin/env sh
set -e
REPO_ROOT="$(git rev-parse --show-toplevel)"
IMAGE="${COMMIT_DEFENDER_IMAGE:-commit-defender:latest}"
STAGED="$(git diff --cached --name-only --diff-filter=ACMR)"
[ -z "$STAGED" ] && exit 0  # nothing staged
docker run --rm \
  -v "${REPO_ROOT}:/repo:ro" \
  -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  -e CD_STAGED_FILES="${STAGED}" \
  "${IMAGE}" 1>&2
exit $?
```

Key: `1>&2` so output always appears (git captures stdout for commit messages).

### Dockerfile (multi-stage)

```
Stage 1 (builder):   python:3.12-slim → install uv, install package + deps
Stage 2 (node):      node:20-slim → npm install -g eslint markdownlint-cli2
Stage 3 (final):     python:3.12-slim → copy python env + node binaries,
                     apt-get install git shellcheck,
                     ENTRYPOINT ["python", "-m", "commit_defender.entrypoint"]
```

---

## Skills Files

Eight skill files in `.claude/skills/`, each self-contained and buildable independently:

| File | Scope |
|---|---|
| `01-project-bootstrap.md` | `pyproject.toml`, package skeleton, `models.py`, SDK setup |
| `02-docker-setup.md` | Multi-stage `Dockerfile`, `docker-compose.yml`, build/run commands |
| `03-static-analysis.md` | `linters/` module: `BaseLinter`, ruff/eslint/shellcheck/markdownlint wrappers |
| `04-diff-extraction.md` | `diff_extractor.py`: subprocess git diff, edge cases, token truncation |
| `05-ai-review-agent.md` | `ai_agent.py`: Anthropic SDK, prompt caching, structured JSON output |
| `06-report-renderer.md` | `renderer.py`: ANSI colors, layout, pass/blocked banner, bypass hint |
| `07-hook-installer.md` | `installer/`: hook template, `install.py` CLI, uninstall, CI usage |
| `08-configuration.md` | `config.py`: Pydantic model, YAML loading, defaults, pathspec excludes |

---

## Environment Variables

| Variable | Source | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | host env | Claude API auth |
| `CD_STAGED_FILES` | hook | newline-separated staged file paths |
| `CD_REPO_PATH` | hook | always `/repo` inside container |
| `CD_SKIP_AI` | optional | skip AI call (offline/CI) |
| `CD_DRY_RUN` | optional | always exit 0 (analysis only) |
| `COMMIT_DEFENDER_IMAGE` | optional | override Docker image tag |

---

## `commit-defender.yaml` Default Schema

```yaml
version: 1
blocking_severity: error   # error | warning | info

linters:
  python:    { enabled: true,  tool: ruff,           args: ["--select", "E,W,F,I"] }
  javascript: { enabled: true,  tool: eslint }
  typescript: { enabled: true,  tool: eslint }
  shell:     { enabled: true,  tool: shellcheck }
  markdown:  { enabled: false, tool: markdownlint }

ai_review:
  enabled: true
  model: claude-sonnet-4-6
  max_tokens: 1024
  blocking: false            # AI findings are advisory by default
  system_prompt_suffix: ""   # project-specific context injection

exclude:
  - "*.lock"
  - "dist/**"
  - "node_modules/**"
  - "*.min.js"
```

---

## Critical Files

| File | Role |
|---|---|
| `pyproject.toml` | Package definition, dependencies |
| `commit_defender/models.py` | Shared data model — all modules depend on it |
| `commit_defender/entrypoint.py` | Pipeline orchestrator |
| `commit_defender/linters/base.py` | Abstract linter interface |
| `commit_defender/ai_agent.py` | Claude API integration with prompt caching |
| `commit_defender/renderer.py` | Terminal report |
| `Dockerfile` | Multi-stage container build |
| `installer/hook_template.sh` | The actual pre-commit shell script |
| `installer/install.py` | Hook install/uninstall CLI |
| `commit-defender.yaml` | Default config |

---

## Verification Steps

1. `docker build -t commit-defender:latest .` — image builds cleanly
2. `python -m installer.install install <path-to-test-repo>` — hook written and executable
3. Stage a Python file with lint errors in the test repo, run `git commit` — hook fires, report printed, commit aborted
4. Stage clean files — commit proceeds (exit 0)
5. `CD_SKIP_AI=1 docker run ...` — works offline, linter-only mode
6. `CD_DRY_RUN=1 docker run ...` — analysis runs but exit 0 always
7. `pytest tests/` — unit tests pass for all modules
