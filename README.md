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

### 1. Set credentials as environment variables

Set the credentials for your chosen provider in your shell profile (e.g. `~/.zshrc` or `~/.bashrc`):

```bash
# Azure OpenAI
export CD_AI_PROVIDER=azure-openai
export CD_API_KEY=your-key
export CD_ENDPOINT=https://your-resource.openai.azure.com
export CD_MODEL=your-deployment-name
export CD_API_VERSION=2024-08-01-preview

# Anthropic
export CD_AI_PROVIDER=anthropic
export CD_API_KEY=your-key
export CD_MODEL=claude-sonnet-4-6

# OpenAI
export CD_AI_PROVIDER=openai
export CD_API_KEY=your-key
export CD_MODEL=gpt-4o

# Google Gemini
export CD_AI_PROVIDER=gemini
export CD_API_KEY=your-key
export CD_MODEL=gemini-2.5-flash
```

### 2. Install the pre-commit hook

```bash
# Install into the current repo
commit-defender install .

# Install into a specific repo
commit-defender install /path/to/your-repo

# Overwrite an existing hook
commit-defender install . --force
```

This writes `.git/hooks/pre-commit` in the target repository.

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

| Setting | Default | Description |
|---|---|---|
| `commitDefender.pythonExecutable` | *(auto)* | Python interpreter with commit-defender installed |
| `commitDefender.aiProvider` | `azure-openai` | `azure-openai` / `anthropic` / `openai` / `gemini` |
| `commitDefender.model` | *(required)* | Model or deployment name |
| `commitDefender.endpoint` | *(Azure only)* | Azure OpenAI endpoint URL |
| `commitDefender.apiKey` | *(required)* | API key — set in User Settings, not Workspace |
| `commitDefender.analysisMode` | `hybrid` | `hybrid` / `ai-powered` / `rule-based` |
| `commitDefender.severityLevel` | `moderate` | How strict the AI review is |
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

| Variable | Purpose |
|---|---|
| `CD_AI_PROVIDER` | AI provider (`azure-openai` / `anthropic` / `openai` / `gemini`) |
| `CD_API_KEY` | API key for the chosen provider |
| `CD_MODEL` | Model or deployment name |
| `CD_ENDPOINT` | API endpoint URL (required for Azure OpenAI) |
| `CD_API_VERSION` | Azure API version (default: `2024-08-01-preview`) |
| `CD_REPO_PATH` | Repo root (set automatically by the hook) |
| `CD_STAGED_FILES` | Newline-separated staged file paths |
| `CD_TARGET_FILES` | Explicit file list for on-demand analysis |
| `CD_JSON` | `1` = emit machine-readable JSON to stdout |
| `CD_ANALYSIS_MODE` | Override analysis mode |
| `CD_SEVERITY_LEVEL` | Override severity level |
| `CD_RICHNESS_LEVEL` | Override richness level |
| `CD_LOCALE` | Override output language |
| `CD_DRY_RUN` | `1` = always exit 0 (analysis only, never blocks) |
| `CD_SKIP_AI` | `1` = skip AI call (linters only, offline mode) |

## License

MIT
