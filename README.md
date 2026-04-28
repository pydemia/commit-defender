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
                            ├── git diff → AI model (code review)
                            └── ANSI report → stderr → you fix it
```

commit-defender runs as a git pre-commit hook. It:
1. Reads your staged files
2. Runs language-appropriate linters (ruff, eslint, shellcheck, markdownlint)
3. Sends the diff to an AI model for a priority-graded code review
4. Prints a human-readable report and blocks the commit if P3 Critical findings are found

## Requirements

- Python 3.12+
- An API key for your chosen AI provider (Azure OpenAI, Anthropic, OpenAI, or Gemini)
- Git

## Installation

```bash
pip install commit-defender
```

## Setup

### 1. Set credentials

**Option A — shell profile** (export in `~/.zshrc` or `~/.bashrc`):

```bash
# Azure OpenAI
export CD_AI_PROVIDER=aoai
export CD_API_KEY=your-azure-openai-key
export CD_ENDPOINT=https://YOUR_RESOURCE.openai.azure.com
export CD_MODEL=your-deployment-name
export CD_API_VERSION=2024-08-01-preview

# Anthropic  (CD_ENDPOINT defaults to https://api.anthropic.com/v1)
export CD_AI_PROVIDER=anthropic
export CD_API_KEY=sk-ant-...
export CD_ENDPOINT=https://api.anthropic.com/v1
export CD_MODEL=claude-sonnet-4-6

# OpenAI  (CD_ENDPOINT defaults to https://api.openai.com/v1)
export CD_AI_PROVIDER=openai
export CD_API_KEY=sk-...
export CD_ENDPOINT=https://api.openai.com/v1
export CD_MODEL=gpt-4o

# Google Gemini  (CD_ENDPOINT defaults to https://generativelanguage.googleapis.com/v1beta/models)
export CD_AI_PROVIDER=gemini
export CD_API_KEY=your-gemini-api-key
export CD_ENDPOINT=https://generativelanguage.googleapis.com/v1beta/models
export CD_MODEL=gemini-2.5-flash
```

**Option B — env file** (keeps credentials out of shell history and source control):

Create a file at any path (e.g. `~/.commit-defender.env`):

```ini
# ~/.commit-defender.env
CD_AI_PROVIDER=anthropic
CD_API_KEY=sk-ant-...
CD_MODEL=claude-sonnet-4-6

# Optional overrides
CD_ANALYSIS_MODE=hybrid
CD_SEVERITY_LEVEL=moderate
CD_LOCALE=en
```

Then point commit-defender to it with the `CD_ENV_FILE` variable:

```bash
export CD_ENV_FILE=~/.commit-defender.env
```

Or when using the VS Code extension, set **Commit Defender: Env File** in User Settings to that path — the extension passes it through automatically.

### 2. Install the pre-commit hook

```bash
# Install into the current repo
commit-defender install .

# Install into a specific repo
commit-defender install /path/to/your-repo

# Use a specific Python interpreter
commit-defender install . --python /path/to/.venv/bin/python
```

The installer is **merge-safe**: if a `.git/hooks/pre-commit` already exists (e.g. from `pre-commit`, husky, or lefthook), commit-defender appends its own named block to that file rather than overwriting it. Running `install` again on a repo that already has commit-defender updates just that block — the rest of the hook is untouched.

```sh
# your existing hook content ...     ← preserved as-is

# BEGIN commit-defender
...commit-defender logic...          ← added / updated in-place
# END commit-defender
```

To update the Python path after switching interpreters, simply re-run `install`:

```bash
commit-defender install . --python /new/path/to/.venv/bin/python
```

Or override at runtime without reinstalling:

```bash
export COMMIT_DEFENDER_PYTHON=/path/to/.venv/bin/python
```

### 3. Commit as usual

```bash
git add .
git commit -m "my changes"
# commit-defender runs automatically
```

### 4. Remove the hook

```bash
commit-defender uninstall .
```

Uninstall strips only the `# BEGIN commit-defender` … `# END commit-defender` block. If other hook content exists it is kept intact; if commit-defender was the only content the file is deleted entirely.

## Priority Levels

Every finding is assigned one of four priority levels:

| Level | Name | Meaning |
|---|---|---|
| **P0** | Praise | Clean code — positive feedback, nothing to fix |
| **P1** | Info | Optional improvement — code works as-is |
| **P2** | Warning | Highly recommended — potential runtime error or bad practice |
| **P3** | Critical | Must fix — syntax error, security vulnerability, or data-loss risk. **Blocks commit** |

P3 findings unconditionally block the commit. P0–P2 are advisory.

## VS Code Extension

Install the **Commit Defender** VS Code extension for inline AI suggestions, CodeLens annotations, inline comment threads, and a summary panel — no terminal required.

Commands available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---|---|
| `Commit Defender: Analyze Staged Files` | Review what's about to be committed |
| `Commit Defender: Analyze Current File` | Review the file open in the editor |
| `Commit Defender: Analyze Directory...` | Pick a directory to review |
| `Commit Defender: Analyze Repository` | Analyze every file in the workspace |
| `Commit Defender: Cancel Analysis` | Stop the running analysis |
| `Commit Defender: Show Summary Panel` | Open the summary webview |
| `Commit Defender: Clear Findings` | Remove all diagnostics and decorations |

Extension settings (configure in VS Code **Settings → Extensions → Commit Defender**):

| Setting | Default | Env var | Description |
|---|---|---|---|
| `commitDefender.pythonExecutable` | *(auto)* | — | Python interpreter with commit-defender installed |
| `commitDefender.envFile` | *(none)* | — | Path to a `.env` file with `CD_*` variables |
| `commitDefender.aiProvider` | `aoai` | `CD_AI_PROVIDER` | `aoai` (Azure OpenAI) / `anthropic` / `openai` / `gemini` |
| `commitDefender.model` | *(empty)* | `CD_MODEL` | Model or deployment name |
| `commitDefender.endpoint` | *(Azure only)* | `CD_ENDPOINT` | Azure OpenAI endpoint URL |
| `commitDefender.apiKey` | *(empty)* | `CD_API_KEY` | API key — set in User Settings or Env File, not Workspace |
| `commitDefender.analysisMode` | `hybrid` | `CD_ANALYSIS_MODE` | `hybrid` / `ai-powered` / `rule-based` |
| `commitDefender.severityLevel` | `moderate` | `CD_SEVERITY_LEVEL` | How strict the AI review is |
| `commitDefender.richnessLevel` | `moderate` | How detailed the feedback is |
| `commitDefender.locale` | `en` | Language (`en` / `ko`) |
| `commitDefender.fileTimeoutSeconds` | `120` | Timeout for single-file analysis |
| `commitDefender.directoryTimeoutSeconds` | `360` | Timeout for directory / repository analysis |
| `commitDefender.excludePatterns` | `[]` | Extra gitignore-style patterns to skip |

## Inline Skip Directives

Add these comments directly in your code to fully suppress all findings on that line. The line is excluded from both the AI review and linter output — no finding of any priority level is generated for it.

| Directive | When to use |
|---|---|
| `# CD:skip` | Explicitly suppress review for this line |
| `# CD:skip:<reason>` | Same suppression — the `<reason>` is a human-readable note for teammates |
| `# type: ignore` | Existing type-checker suppression; also suppresses commit-defender |
| `# TODO` | Known unfinished work; suppress until it is addressed |

```python
risky_call()  # CD:skip

password = TEST_PASSWORD  # CD:skip:test fixture, never used in production

result = cast(int, value)  # type: ignore

def stub():  # TODO: implement proper validation
    pass
```

Suppression is enforced at two layers: the AI is instructed to omit marked lines from `file_comments`, and a post-processing step removes any findings that slipped through.

## Analysis Modes

| Mode | Linters | AI | Use case |
|---|---|---|---|
| `hybrid` | ✓ | ✓ | Default — thorough review |
| `ai-powered` | ✗ | ✓ | Faster, no toolchain needed |
| `rule-based` | ✓ | ✗ | Offline, deterministic |

## Severity Levels

`lean` → `generous` → `moderate` → `rigorous` → `severe`

Controls how strictly the AI assigns priority levels. Higher strictness pushes more findings toward P2/P3.

## Environment Variables

Every user-facing setting can be controlled via a `CD_*` environment variable. Set them in your shell profile, or place them in an env file and point `CD_ENV_FILE` to it.

| Variable | VS Code setting | Description |
|---|---|---|
| `CD_ENV_FILE` | `commitDefender.envFile` | Path to a `.env` file containing other `CD_*` variables |
| `CD_AI_PROVIDER` | `commitDefender.aiProvider` | `aoai` / `anthropic` / `openai` / `gemini` |
| `CD_API_KEY` | `commitDefender.apiKey` | API key for the chosen provider |
| `CD_MODEL` | `commitDefender.model` | Model or deployment name |
| `CD_ENDPOINT` | `commitDefender.endpoint` | API endpoint URL (required for Azure OpenAI) |
| `CD_API_VERSION` | `commitDefender.apiVersion` | Azure API version (default: `2024-08-01-preview`) |
| `CD_MAX_TOKENS` | `commitDefender.maxTokens` | Max AI output tokens (default: `4096`) |
| `CD_ANALYSIS_MODE` | `commitDefender.analysisMode` | `hybrid` · `ai-powered` · `rule-based` |
| `CD_SEVERITY_LEVEL` | `commitDefender.severityLevel` | `severe` · `rigorous` · `moderate` · `generous` · `lean` |
| `CD_RICHNESS_LEVEL` | `commitDefender.richnessLevel` | `colorful` · `chatty` · `moderate` · `simple` · `silent` |
| `CD_LOCALE` | `commitDefender.locale` | `en` · `ko` |
| `CD_EXCLUDE_PATTERNS` | `commitDefender.excludePatterns` | Comma-separated gitignore-style exclude patterns (e.g. `tests/**,*.generated.ts`) |
| `CD_STAGED_FILES_WARN_THRESHOLD` | `commitDefender.stagedFilesWarnThreshold` | Warn when staged file count exceeds N (default: `20`) |
| `CD_REPO_ANALYSIS_WARN_THRESHOLD` | `commitDefender.repoAnalysisWarnThreshold` | Confirm when repo file count exceeds N (default: `80`) |
| `CD_REPO_PATH` | — | Repo root (set automatically by the hook / extension) |
| `CD_STAGED_FILES` | — | Newline-separated staged file paths (hook mode) |
| `CD_TARGET_FILES` | — | Explicit file list for on-demand analysis |
| `CD_JSON` | — | `1` = emit machine-readable JSON to stdout |
| `CD_DRY_RUN` | — | `1` = always exit 0 (analysis only, never blocks) |
| `CD_SKIP_AI` | — | `1` = skip AI call (linters only, offline mode) |

## License

MIT
