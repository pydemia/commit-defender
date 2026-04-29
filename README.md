# commit-defender

**AI-powered git pre-commit code review for VS Code.** Catches bugs, security issues, and style violations before they land — inline in the editor and at `git commit` time.

Commit Defender is a pure TypeScript VS Code extension. It talks to your AI provider (Azure OpenAI · Anthropic · OpenAI · Google Gemini) directly over HTTPS and ships its own self-contained git pre-commit hook that works even when VS Code is closed.

---

## How it works

```
git add foo.ts
    │
    ▼
VS Code extension  ──► AI provider  ──► priority-graded findings
                                        (P0 / P1 / P2 / P3)
                                            │
                                            ├── inline comment threads
                                            ├── Problems panel diagnostics
                                            ├── CodeLens badges
                                            └── summary webview

git commit
    │
    ▼
.git/hooks/pre-commit
    │
    ▼
node out/hook-cli.js  ──► AI provider  ──► same review, terminal output
                                            │
                                            └── exit 1 on any P3 → commit blocked
```

Both paths run the **same review** with the **same settings**. The hook reads a materialised config file (`<repo>/.commit-defender/hook.json`) that the extension writes whenever your settings change, so the hook works without VS Code running.

---

## Install

1. Install **Commit Defender** from the VS Code Marketplace.
2. Open **Settings → Extensions → Commit Defender** and set:
   - `commitDefender.aiProvider` (one of `aoai` / `anthropic` / `openai` / `gemini`)
   - `commitDefender.model` (e.g. `claude-sonnet-4-6`, `gpt-4o`)
   - `commitDefender.apiKey` (in **User Settings**, not Workspace)
   - `commitDefender.endpoint` (required for Azure OpenAI only)
3. (Optional) Set `commitDefender.preCommitHook: enable` to install the standalone git pre-commit hook.

That's it. Stage a file and findings appear in the editor.

For the full setup guide, settings reference, and pre-commit hook details, see [vscode-extension/README.md](vscode-extension/README.md).

---

## Priority levels

Every finding carries one of four acceptance levels:

| Level | Name | Meaning |
|---|---|---|
| 🟩 **P0** | Praise | Clean code — positive feedback, nothing to fix |
| 🟦 **P1** | Info | Optional improvement — code works as-is |
| 🟧 **P2** | Warning | Highly recommended — potential runtime error or bad practice |
| 🟥 **P3** | Critical | Must fix — syntax error, security vulnerability, or data-loss risk. **Blocks commit** |

P3 findings unconditionally block the commit. P0–P2 are advisory.

---

## Inline skip directives

Add these comments to fully suppress findings on a given line:

| Directive | When to use |
|---|---|
| `# CD:skip` | Explicitly suppress review for this line |
| `# CD:skip:<reason>` | Same suppression — `<reason>` is a human-readable note |
| `# type: ignore` | Honoured as an existing type-checker suppression marker |
| `# TODO` | Known unfinished work — suppress until addressed |

---

## Per-repo skills

Drop SKILL.md files under `<repo>/.commit-defender/<topic>/SKILL.md` to inject project-specific guidance into every review for that repo. The directory name becomes the section heading and the file body is appended to the AI's system prompt.

---

## Severity & richness

Two prompt-shaping knobs control how strict and how verbose the AI is:

- `commitDefender.severityLevel`: `lean` → `generous` → `moderate` → `rigorous` → `severe`
- `commitDefender.richnessLevel`: `silent` → `simple` → `moderate` → `chatty` → `colorful`

Higher severity pushes more findings toward P2/P3. Higher richness gives longer per-finding explanations.

---

## Privacy

Commit Defender sends your **staged diff** (or full file contents in on-demand mode) plus the system prompt to the AI provider you configure. The API key is sent only to that provider. No analytics, no telemetry, no third-party servers.

Review your provider's data-retention policy before enabling AI review on sensitive codebases.

---

## License

MIT — see [LICENSE](LICENSE).
