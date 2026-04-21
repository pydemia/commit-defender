# Commit Defender

**AI-powered pre-commit code review with priority-graded findings, inline in VS Code.**

Commit Defender intercepts your staged changes before they land, runs static analysis and an AI review, then surfaces findings directly in the editor — each tagged with a priority level so you know exactly what must be fixed now versus what can wait. P3 Critical findings block the commit automatically.

---

## Features

### Priority-graded review comments

Every AI finding is assigned one of four acceptance levels:

| Level | Name | Color | Meaning |
|---|---|---|---|
| **P0** | Praise | 🟩 Green | Clean code — positive feedback, nothing to fix |
| **P1** | Info | 🟦 Blue | Optional improvement — code works as-is, purely for cleaner structure |
| **P2** | Warning | 🟧 Orange | Highly recommended — potential runtime error, bad practice, or performance risk |
| **P3** | Critical | 🟥 Red | Must fix — syntax error, security vulnerability, or data-loss risk. **Blocks commit** |

Findings appear as inline comment threads in the editor (one thread per line, one comment per finding), in the Problems panel, and as CodeLens badges above each affected line.

### Automatic analysis on `git add`
Stage a file and Commit Defender silently runs in the background. Findings appear as diagnostics in the Problems panel and inline editor comments — no manual trigger needed.

### AI code review
The staged diff is sent to your chosen AI provider (Azure OpenAI, Anthropic Claude, OpenAI, or Google Gemini). The model returns structured findings: priority level, category, line reference, and an actionable suggestion.

### Static linting (hybrid mode)
In `hybrid` mode, Commit Defender runs language-specific linters first — `ruff` for Python, `eslint` for JS/TS, `shellcheck` for shell scripts — then feeds those results to the AI for a combined review. Or run linters only (`rule-based`) or AI only (`ai-powered`).

### Summary panel
Open a rich summary webview from the activity bar or command palette. See a pass/blocked verdict, a quality grade, all findings grouped by file with priority color-coding, and the raw JSON report for debugging.

### Analysis scope
Run analysis on:
- Staged files only (default, triggered by `git add`)
- The currently open file
- Any directory
- The entire repository

### Multi-provider AI support
| Provider | Example models |
|---|---|
| **Azure OpenAI** | Your deployment name |
| **Anthropic** | `claude-sonnet-4-6`, `claude-opus-4-6` |
| **OpenAI** | `gpt-4o`, `o3` |
| **Google Gemini** | `gemini-2.5-pro`, `gemini-2.5-flash` |

---

## Requirements

- Python 3.10+ with `commit-defender` installed (`pip install commit-defender`)
- A Git repository open in VS Code
- An API key for your chosen AI provider

> **Tip:** Leave `commitDefender.pythonExecutable` empty and Commit Defender will auto-detect the interpreter selected in the VS Code Python extension.

---

## Setup

### 1. Install the Python backend

```bash
pip install commit-defender
```

### 2. Set your API credentials

**Option A — VS Code Settings (User Settings only, never Workspace):**

Open **Settings → Extensions → Commit Defender** and set `commitDefender.apiKey`, `commitDefender.aiProvider`, `commitDefender.model`, and (for Azure) `commitDefender.endpoint`.

**Option B — Env File (recommended for keeping credentials out of VS Code):**

Create a `.env` file anywhere on your machine (e.g. `~/.commit-defender.env`):

```ini
# ~/.commit-defender.env
CD_AI_PROVIDER=anthropic
CD_API_KEY=sk-ant-...
CD_MODEL=claude-sonnet-4-6
```

Then point the extension to it in **Settings → Extensions → Commit Defender → Env File**:

```
~/.commit-defender.env
```

VS Code settings take precedence over env file values when both are set.

### 3. Configure your provider

Open **Settings → Extensions → Commit Defender** and set:

| Setting | Env var | Description |
|---|---|---|
| `commitDefender.aiProvider` | `CD_AI_PROVIDER` | `aoai` (Azure OpenAI) / `anthropic` / `openai` / `gemini` |
| `commitDefender.model` | `CD_MODEL` | Model or deployment name |
| `commitDefender.endpoint` | `CD_ENDPOINT` | Required for Azure OpenAI |
| `commitDefender.apiVersion` | `CD_API_VERSION` | Azure API version (default: `2024-08-01-preview`) |

---

## Priority Levels

Commit Defender uses a four-level priority system to classify every review comment by urgency. This replaces vague "warning/error" labels with a human-readable acceptance signal.

| Level | Name | When to use |
|---|---|---|
| 🟩 **P0 Praise** | Positive feedback | Code is clean and exemplary — nothing to flag |
| 🟦 **P1 Info** | Optional improvement | Code works correctly as-is. Better naming, cleaner structure, readability — zero functional impact if skipped |
| 🟧 **P2 Warning** | Highly recommended fix | Code runs now but carries real risk: potential runtime errors, deprecated APIs, poor error handling, or performance problems |
| 🟥 **P3 Critical** | Commit blocked | Broken or dangerous right now — syntax errors, import failures, security vulnerabilities, data-loss risk — **must be fixed before committing** |

P3 findings unconditionally block the commit regardless of any other configuration. P0 is only emitted when there is genuinely nothing negative to say about a file.

---

## Extension Settings

| Setting | Default | Env var | Description |
|---|---|---|---|
| `commitDefender.pythonExecutable` | *(auto)* | — | Python interpreter path. Auto-detects from VS Code Python extension when empty. |
| `commitDefender.envFile` | *(none)* | — | Path to a `.env` file with `CD_*` variables (e.g. `~/.commit-defender.env`). Keeps credentials out of VS Code settings. |
| `commitDefender.aiProvider` | `aoai` | `CD_AI_PROVIDER` | `aoai` (Azure OpenAI) · `anthropic` · `openai` · `gemini` |
| `commitDefender.model` | *(empty)* | `CD_MODEL` | Model or deployment name |
| `commitDefender.endpoint` | *(empty)* | `CD_ENDPOINT` | API endpoint URL (required for Azure OpenAI) |
| `commitDefender.apiVersion` | `2024-08-01-preview` | `CD_API_VERSION` | Azure API version (ignored for other providers) |
| `commitDefender.apiKey` | *(empty)* | `CD_API_KEY` | API key — set in User Settings or Env File, never Workspace |
| `commitDefender.maxTokens` | `4096` | `CD_MAX_TOKENS` | Max output tokens for the AI response |
| `commitDefender.analysisMode` | `hybrid` | `CD_ANALYSIS_MODE` | `hybrid` · `ai-powered` · `rule-based` |
| `commitDefender.severityLevel` | `moderate` | `CD_SEVERITY_LEVEL` | How strict the AI reviewer is: `severe` → `lean` |
| `commitDefender.richnessLevel` | `moderate` | `CD_RICHNESS_LEVEL` | How detailed the feedback is: `colorful` → `silent` |
| `commitDefender.locale` | `en` | `CD_LOCALE` | Review language: `en` or `ko` (한국어) |
| `commitDefender.excludePatterns` | `[]` | `CD_EXCLUDE_PATTERNS` | Gitignore-style patterns to skip (comma-separated in env var, e.g. `tests/**,*.generated.ts`) |
| `commitDefender.stagedFilesWarnThreshold` | `20` | `CD_STAGED_FILES_WARN_THRESHOLD` | Warn before analyzing more than N staged files. `0` = no prompt |
| `commitDefender.repoAnalysisWarnThreshold` | `80` | `CD_REPO_ANALYSIS_WARN_THRESHOLD` | Confirm before analyzing more than N files repo-wide. `0` = no prompt |
| `commitDefender.runOnStage` | `true` | — | Auto-analyze when files are staged |
| `commitDefender.preCommitHook` | `disable` | — | `enable` = auto-install git pre-commit hook on activation · `disable` = skip |
| `commitDefender.fileTimeoutSeconds` | `120` | — | Timeout for single-file analysis |
| `commitDefender.directoryTimeoutSeconds` | `360` | — | Timeout for directory / repository analysis |

---

## Commands

All commands are available in the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---|---|
| `Commit Defender: Analyze Staged Files` | Run analysis on staged files now |
| `Commit Defender: Analyze Current File` | Analyze the file open in the editor |
| `Commit Defender: Analyze Directory...` | Pick a directory to analyze |
| `Commit Defender: Analyze Repository` | Analyze every file in the workspace |
| `Commit Defender: Cancel Analysis` | Stop the running analysis |
| `Commit Defender: Show Summary Panel` | Open the summary webview |
| `Commit Defender: Clear Findings` | Remove all diagnostics and decorations |

Shortcut buttons also appear in the **Source Control** panel title bar and the **editor title bar**.

---

## Analysis Modes

| Mode | What runs | Use when |
|---|---|---|
| `hybrid` | Linters + AI with priority grading | Default — best signal-to-noise ratio |
| `ai-powered` | AI only with priority grading | No linter toolchain; fast feedback |
| `rule-based` | Linters only, no AI | Offline / CI, fully deterministic |

In `rule-based` mode the summary panel shows a linter-only report. Priority grading is applied only when the AI review runs.

---

## Severity & Richness Levels

**Severity** controls how strictly the AI assigns priority levels. Higher strictness pushes more findings toward P2/P3:
- `severe` — zero tolerance; nearly everything becomes P2 (Warning) or P3 (Critical)
- `rigorous` — strict; style issues escalate to P2, most things flagged
- `moderate` — balanced; P1/P2/P3 assigned by genuine impact *(default)*
- `generous` — lenient; minor things become P1 (Info), only real risks reach P2/P3
- `lean` — minimal; only P3-worthy issues flagged

**Richness** controls how much explanation accompanies each finding:
- `colorful` — elaborate: examples, alternatives, trade-off discussion
- `chatty` — detailed with helpful context
- `moderate` — clear and concise *(default)*
- `simple` — brief, one or two sentences
- `silent` — one-line summaries only

---

## Pass / Fail Logic

A commit is **blocked** (exit code 1) when any of the following is true:

1. Any **P3 Critical** AI comment is present
2. Any lint finding at or above the configured `blocking_severity` threshold (`error` by default)
3. The AI review itself returns `blocking: true` and the config `ai_review.blocking` gate is enabled

P0, P1, and P2 findings are **never blocking** — they appear in the summary and Problems panel as advisory information only.

---

## Inline Skip Directives

Add these comments directly in your code to fully suppress all findings on that line. The line is excluded from both the AI review and linter output — no finding is generated regardless of priority level.

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

Suppression is enforced at two layers: the AI is instructed to omit marked lines from its output, and a post-processing step removes any findings that slipped through.

---

## Git Pre-commit Hook (CLI mode)

You can run Commit Defender as a real `git commit` blocker — without VS Code — using the built-in hook installer.

### 1. Install the hook

```bash
commit-defender install .

# With a specific Python (e.g. a virtualenv)
commit-defender install . --python /path/to/.venv/bin/python

# Overwrite an existing hook
commit-defender install . --force
```

This writes `.git/hooks/pre-commit` in the target repository.

### 2. Set credentials

**Option A — shell profile** (credentials available at every commit):

```bash
# ~/.zshrc or ~/.bashrc
export CD_AI_PROVIDER=anthropic
export CD_API_KEY=sk-ant-...
export CD_MODEL=claude-sonnet-4-6
```

**Option B — env file** (pass path via `CD_ENV_FILE` or point the VS Code extension to it):

```ini
# ~/.commit-defender.env
CD_AI_PROVIDER=anthropic
CD_API_KEY=sk-ant-...
CD_MODEL=claude-sonnet-4-6
```

All supported variables:

| Variable | Required | Description |
|---|---|---|
| `CD_AI_PROVIDER` | Yes | `aoai` · `anthropic` · `openai` · `gemini` |
| `CD_API_KEY` | Yes | API key for the chosen provider |
| `CD_MODEL` | Yes | Deployment name (Azure) or model name (others) |
| `CD_ENDPOINT` | Azure only | `https://YOUR.openai.azure.com` |
| `CD_API_VERSION` | Azure only | e.g. `2024-08-01-preview` |
| `CD_ANALYSIS_MODE` | No | `hybrid` · `ai-powered` · `rule-based` (default: `hybrid`) |
| `CD_SEVERITY_LEVEL` | No | `severe` · `rigorous` · `moderate` · `generous` · `lean` |
| `CD_RICHNESS_LEVEL` | No | `colorful` · `chatty` · `moderate` · `simple` · `silent` |
| `CD_LOCALE` | No | `en` · `ko` |
| `CD_EXCLUDE_PATTERNS` | No | Comma-separated gitignore-style patterns to skip (e.g. `tests/**,*.generated.ts`) |
| `CD_STAGED_FILES_WARN_THRESHOLD` | No | Warn when more than N files are staged (default: `20`) |
| `CD_REPO_ANALYSIS_WARN_THRESHOLD` | No | Confirm when more than N files in repo scan (default: `80`) |
| `CD_MAX_TOKENS` | No | Max AI output tokens (default: `4096`) |

### 3. Remove the hook

```bash
commit-defender uninstall .
```

### How it works

When you run `git commit`, the hook collects staged files and calls `python -m commit_defender.entrypoint`. Findings print to the terminal. Any **P3 Critical** finding exits with code 1, blocking the commit. Use `git commit --no-verify` to bypass.

---

## Troubleshooting

**"Could not parse AI response as JSON"**
Increase `commitDefender.maxTokens`. The response was truncated mid-JSON, usually on large diffs.

**"python3: command not found" / "No module named commit_defender"**
Set `commitDefender.pythonExecutable` to the full path of the interpreter where you installed `commit-defender` (e.g. `/home/user/.venv/bin/python`).

**Encoding errors on Windows (cp949 / Korean locale)**
Commit Defender handles non-UTF-8 output safely with `errors="replace"`. If you see a raw encoding error, update to the latest version.

**Analysis never triggers automatically**
Check that `commitDefender.runOnStage` is `true` and that the workspace has a `.git` folder (the extension activates only in git repositories).

---

## Privacy

Commit Defender sends **only your staged diff and lint findings** to the AI provider you configure. No file paths, no repository metadata, no credentials are transmitted. Review your provider's data policy before enabling AI review on sensitive codebases.

---

## License

MIT — see [LICENSE](LICENSE).
