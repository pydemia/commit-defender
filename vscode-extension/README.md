# Commit Defender

**AI-powered pre-commit code review with priority-graded findings, inline in VS Code.**

Commit Defender intercepts your staged changes before they land, asks an AI to review them, and surfaces findings directly in the editor — each tagged with a priority level so you know exactly what must be fixed now versus what can wait. P3 Critical findings block the commit automatically.

The extension talks to your AI provider directly and ships its own git pre-commit hook that works even when VS Code is closed.

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

### Multi-provider AI support

| Provider | Example models | Default endpoint |
|---|---|---|
| **Azure OpenAI** | Your deployment name | *(required — your Azure resource URL)* |
| **Anthropic** | `claude-sonnet-4-6`, `claude-opus-4-6` | `https://api.anthropic.com/v1` |
| **OpenAI** | `gpt-4o`, `o3` | `https://api.openai.com/v1` |
| **Google Gemini** | `gemini-2.5-pro`, `gemini-2.5-flash` | `https://generativelanguage.googleapis.com/v1beta` |

### Automatic analysis on `git add`

Stage a file and Commit Defender silently runs in the background. Findings appear as diagnostics in the Problems panel and inline editor comments — no manual trigger needed.

### Standalone pre-commit hook

Enable `commitDefender.preCommitHook: enable` and the extension installs a tiny shell hook into `.git/hooks/pre-commit`. The hook calls a bundled Node script that runs the **exact same review** at `git commit` time, even when VS Code isn't running. Settings flow through automatically (see [Pre-commit Hook](#pre-commit-hook) below).

### Summary panel

Open a rich summary webview from the activity bar or command palette. See a pass/blocked verdict, a quality grade, all findings grouped by file with priority color-coding, and the raw JSON report for debugging.

### Analysis scope

Run analysis on:
- Staged files only (default, triggered by `git add`)
- The currently open file
- Any directory
- The entire repository

### Commit message generator

Generate a structured commit message from the current staged diff. Click the wand icon in the Source Control title bar — the message lands in the SCM input box ready to send.

### Per-repo skills

Drop a `SKILL.md` file under `<repo>/.commit-defender/<topic>/SKILL.md` and it is injected into the AI's system prompt for every review in that repo. Use it for project-specific conventions, security policies, naming rules, etc.

---

## Requirements

- VS Code 1.90+
- Node.js 18+ (for the standalone pre-commit hook only — VS Code itself bundles Node so the in-editor experience needs nothing)
- A Git repository open in VS Code
- An API key for your chosen AI provider

---

## Setup

### 1. Configure your provider

Open **Settings → Extensions → Commit Defender** (or paste directly into `settings.json`) and fill in the block for your provider.

> Store `commitDefender.apiKey` in **User Settings**, not Workspace Settings — Workspace settings live in `.vscode/settings.json` and are typically committed to the repo.

#### Azure OpenAI (`aoai`)

```json
"commitDefender.aiProvider": "aoai",
"commitDefender.endpoint":   "https://YOUR_RESOURCE.openai.azure.com",
"commitDefender.model":      "your-deployment-name",
"commitDefender.apiVersion": "2024-08-01-preview",
"commitDefender.apiKey":     "your-azure-openai-key"
```

#### Anthropic

```json
"commitDefender.aiProvider": "anthropic",
"commitDefender.model":      "claude-sonnet-4-6",
"commitDefender.apiKey":     "sk-ant-..."
```

#### OpenAI

```json
"commitDefender.aiProvider": "openai",
"commitDefender.model":      "gpt-4o",
"commitDefender.apiKey":     "sk-..."
```

#### Google Gemini

```json
"commitDefender.aiProvider": "gemini",
"commitDefender.model":      "gemini-2.5-flash",
"commitDefender.apiKey":     "your-gemini-api-key"
```

`endpoint` can be omitted for `anthropic`, `openai`, and `gemini` — the defaults are used. It is required for `aoai`.

### 2. (Optional) Install the pre-commit hook

```jsonc
"commitDefender.preCommitHook": "enable"
```

The extension installs `.git/hooks/pre-commit` and writes a `<repo>/.commit-defender/hook.json` config file (auto-`.gitignore`d) so the hook can run without VS Code. See [Pre-commit Hook](#pre-commit-hook) below for details.

### 3. Commit

Stage some files. Findings appear in the Problems panel and inline. Run `git commit` from any terminal — if the hook is installed, it runs automatically.

---

## Priority Levels

Commit Defender uses a four-level priority system to classify every review comment by urgency.

| Level | Name | When |
|---|---|---|
| 🟩 **P0 Praise** | Positive feedback | Code is clean and exemplary — nothing to flag |
| 🟦 **P1 Info** | Optional improvement | Code works correctly as-is. Better naming, cleaner structure, readability — zero functional impact if skipped |
| 🟧 **P2 Warning** | Highly recommended fix | Code runs now but carries real risk: potential runtime errors, deprecated APIs, poor error handling, or performance problems |
| 🟥 **P3 Critical** | Commit blocked | Broken or dangerous right now — syntax errors, import failures, security vulnerabilities, data-loss risk — **must be fixed before committing** |

P3 findings unconditionally block the commit. P0 is only emitted when the file has nothing negative.

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `commitDefender.aiProvider` | `aoai` | `aoai` (Azure OpenAI) · `anthropic` · `openai` · `gemini` |
| `commitDefender.model` | *(empty)* | Model or deployment name |
| `commitDefender.endpoint` | *(empty)* | API endpoint URL (required for Azure OpenAI; defaults used for others) |
| `commitDefender.apiVersion` | `2024-08-01-preview` | Azure API version (ignored for other providers) |
| `commitDefender.apiKey` | *(empty)* | API key — **set in User Settings, never Workspace** |
| `commitDefender.maxTokens` | `4096` | Max output tokens for the AI response |
| `commitDefender.severityLevel` | `moderate` | How strict the AI reviewer is: `severe` → `lean` |
| `commitDefender.richnessLevel` | `moderate` | How detailed the feedback is: `colorful` → `silent` |
| `commitDefender.locale` | `en` | Review language: `en` or `ko` (한국어) |
| `commitDefender.excludePatterns` | `[]` | Gitignore-style patterns to skip in addition to the repo's `.gitignore` |
| `commitDefender.colorPalette` | `theme-adaptive` | Color palette for priority badges (14 options including colorblind-safe sets) |
| `commitDefender.runOnStage` | `true` | Auto-analyze when files are staged |
| `commitDefender.preCommitHook` | `disable` | `enable` → install the standalone git pre-commit hook on activation |
| `commitDefender.fileTimeoutSeconds` | `120` | Timeout for single-file analysis. `0` = no limit |
| `commitDefender.directoryTimeoutSeconds` | `360` | Timeout for directory / repository analysis. `0` = no limit |
| `commitDefender.stagedFilesWarnThreshold` | `20` | Warn before analyzing more than N staged files. `0` = no prompt |
| `commitDefender.repoAnalysisWarnThreshold` | `80` | Confirm before analyzing more than N files repo-wide. `0` = no prompt |

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
| `Commit Defender: Generate Commit Message` | Draft a structured commit message from the staged diff |
| `Commit Defender: Install Pre-commit Hook` | Install `.git/hooks/pre-commit` and materialise the hook config |
| `Commit Defender: Uninstall Pre-commit Hook` | Remove the Commit Defender pre-commit hook |

Shortcut buttons appear in the **Source Control** panel title bar (analyze + commit-message wand) and the **editor title bar** (analyze current file).

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

## Pre-commit Hook

When `commitDefender.preCommitHook` is `enable`, the extension installs a small shell script at `.git/hooks/pre-commit`:

```sh
#!/usr/bin/env sh
# commit-defender hook v2
exec node "<extension-path>/out/hook-cli.js" "$REPO_ROOT"
```

That bundled CLI does the exact same review as the in-editor command and exits non-zero on P3 findings — blocking the commit. It works from any context that runs git: terminal, Tower, GitKraken, lazygit, GitHub Desktop, CI runners.

### How settings reach the hook

The hook can't query VS Code at commit time, so the extension materialises your settings into `<repo>/.commit-defender/hook.json` whenever they change. The file is automatically added to `.gitignore` so the API key doesn't leak.

```jsonc
// <repo>/.commit-defender/hook.json (auto-generated, do NOT edit by hand)
{
  "aiProvider": "anthropic",
  "model": "claude-sonnet-4-6",
  "endpoint": "",
  "apiKey": "sk-ant-...",
  "maxTokens": 4096,
  "severityLevel": "moderate",
  "richnessLevel": "moderate",
  "locale": "en",
  "excludePatterns": []
}
```

### If a hook already exists

If `.git/hooks/pre-commit` already contains content from another tool (husky, pre-commit, lefthook, …), the install command **prompts** before replacing it and writes a backup at `pre-commit.backup-<timestamp>`. Restore manually if needed.

### Bypassing the hook

Use `git commit --no-verify` (or `-n`) to skip the hook for one commit. The extension never blocks a commit silently.

### Disabling

Set `commitDefender.preCommitHook: disable` or run `Commit Defender: Uninstall Pre-commit Hook`. The hook script is removed; the `hook.json` config file is left in place (uninstall is reversible).

### Hook + Node availability

The bundled CLI requires `node` ≥ 18 in the PATH at commit time. If `node` isn't found, the hook prints a warning and exits 0 (does not block). Use [nvm](https://github.com/nvm-sh/nvm), [asdf](https://asdf-vm.com/), [Volta](https://volta.sh/), or your system package manager to install Node.

---

## Inline Skip Directives

Add these comments directly in your code to fully suppress all findings on that line:

| Directive | When to use |
|---|---|
| `# CD:skip` | Explicitly suppress review for this line |
| `# CD:skip:<reason>` | Same suppression — the `<reason>` is a human-readable note for teammates |
| `# type: ignore` | Honoured as an existing type-checker suppression marker |
| `# TODO` | Known unfinished work; suppress until it is addressed |

```
risky_call()                    # CD:skip
password = TEST_PASSWORD        # CD:skip:test fixture, never used in production
result = cast(int, value)       # type: ignore
def stub():                     # TODO: implement proper validation
```

Suppression is enforced at two layers: the AI is instructed to omit marked lines from its output, and a post-processing step removes any findings that slipped through.

---

## Per-repo Skills

Drop SKILL.md files under `.commit-defender/` to inject project-specific guidance into the AI's system prompt:

```
your-repo/
  .commit-defender/
    security/
      SKILL.md          ← "Block any new use of subprocess.shell=True…"
    naming/
      SKILL.md          ← "Class names must be PascalCase, …"
```

Each `SKILL.md` is concatenated into a single section labelled `Active Review Skills` and prepended to every review for that repo. The directory name (`security`, `naming`) becomes the section heading. Used by both the in-editor commands and the standalone pre-commit hook.

---

## Privacy

Commit Defender sends your **staged diff** (or full file contents in on-demand mode) to the AI provider you configure. Repository metadata, file paths, and the system prompt go along with that. The API key is sent only to the configured provider.

Review your provider's data-retention policy before enabling AI review on sensitive codebases. The extension does not phone home — there is no analytics or telemetry.

---

## Troubleshooting

**"Could not parse AI response as JSON"**
Increase `commitDefender.maxTokens`. The response was truncated mid-JSON, usually on large diffs.

**"AI review unavailable: Missing … API key"**
Set `commitDefender.apiKey` in User Settings.

**Hook says `node not found in PATH`**
Install Node 18+ and ensure `command -v node` resolves in the shell that runs `git commit`.

**Analysis never triggers automatically**
Check that `commitDefender.runOnStage` is `true` and that the workspace has a `.git` folder (the extension activates only in git repositories).

**Hook isn't using my latest setting**
The hook config is updated only on `onDidChangeConfiguration` events from a running VS Code window with the extension active. Make a one-character edit to settings.json (or run `Commit Defender: Install Pre-commit Hook` again) to force a re-write.

---

## License

MIT — see [LICENSE](LICENSE).
