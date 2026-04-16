# commit-defender

AI-powered git pre-commit code review. Catches bugs, security issues, and style violations before they land — right in your terminal or VS Code.

## How it works

```
git commit
    │
    ▼
pre-commit hook  ──►  commit-defender
                            │
                            ├── ruff / eslint / shellcheck (linters)
                            ├── git diff → Azure OpenAI (AI review)
                            └── ANSI report → stderr → you fix it
```

commit-defender runs as a git pre-commit hook. It:
1. Reads your staged files
2. Runs language-appropriate linters (ruff, eslint, shellcheck, markdownlint)
3. Sends the diff to an AI model for a code review
4. Prints a human-readable report and blocks the commit if issues are found

## Requirements

- Python 3.12+
- Azure OpenAI credentials (API key, endpoint, deployment)
- Git

## Installation

```bash
pip install commit-defender
```

## Setup

### 1. Credentials

Create `~/.commit-defender.env`:

```env
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

Or set the environment variables directly.

### 2. Install the pre-commit hook

```bash
# Install into the current repo
commit-defender install

# Install into a specific repo
commit-defender install /path/to/your-repo
```

### 3. Commit as usual

```bash
git add .
git commit -m "my changes"
# commit-defender runs automatically
```

## VS Code Extension

Install the **Commit Defender** VS Code extension for inline AI suggestions, CodeLens, and hover cards — no terminal required.

Commands available:
- **Commit Defender: Analyze Staged Files** — review what's about to be committed
- **Commit Defender: Analyze Current File** — review the file open in the editor
- **Commit Defender: Analyze Directory...** — pick a directory to review

Extension settings:

| Setting | Default | Description |
|---|---|---|
| `commitDefender.pythonExecutable` | `${workspaceFolder}/.venv/bin/python` | Python with commit-defender installed |
| `commitDefender.analysisMode` | `` | `hybrid` / `ai-powered` / `rule-based` |
| `commitDefender.severityLevel` | `moderate` | How strict the AI review is |
| `commitDefender.richnessLevel` | `moderate` | How detailed the feedback is |
| `commitDefender.locale` | `en` | Language (`en` / `ko`) |
| `commitDefender.excludePatterns` | `[]` | Extra gitignore-style patterns to skip |

## Configuration

Place a `.commit-defender/settings.json` in your repo:

```json
{
  "analysisMode": "hybrid",
  "severityLevel": "moderate",
  "richnessLevel": "moderate",
  "locale": "en",
  "excludePatterns": [
    "**/node_modules/**",
    "**/.venv/**",
    "*.min.js",
    "dist/**"
  ]
}
```

### Analysis modes

| Mode | Linters | AI | Use case |
|---|---|---|---|
| `hybrid` | ✓ | ✓ | Default — thorough review |
| `ai-powered` | ✗ | ✓ | Faster, no toolchain needed |
| `rule-based` | ✓ | ✗ | Offline, deterministic |

### Severity levels

`lean` → `generous` → `moderate` → `rigorous` → `severe`

### Skill files

Drop `.commit-defender/<skill-name>/SKILL.md` files in your repo to inject project-specific context into the AI review (e.g. your coding conventions, security requirements, or architecture notes).

## Environment variables

| Variable | Purpose |
|---|---|
| `CD_REPO_PATH` | Repo root (set automatically by the hook) |
| `CD_STAGED_FILES` | Newline-separated staged file paths |
| `CD_TARGET_FILES` | Explicit file list for on-demand analysis |
| `CD_JSON` | `1` = emit machine-readable JSON to stdout |
| `CD_ANALYSIS_MODE` | Override analysis mode |
| `CD_SEVERITY_LEVEL` | Override severity level |
| `CD_RICHNESS_LEVEL` | Override richness level |
| `CD_LOCALE` | Override output language |
| `CD_DRY_RUN` | `1` = always exit 0 (analysis only) |
| `CD_HOME_ENV_FILE` | Path to credentials .env file |

## License

MIT
