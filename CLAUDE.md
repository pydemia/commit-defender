commit-defender is an AI-powered git pre-commit code review tool for VS Code.

It is a pure TypeScript VS Code extension that talks to AI providers (Azure
OpenAI, Anthropic, OpenAI, Google Gemini) directly over HTTPS and ships its
own self-contained git pre-commit hook. The hook works at `git commit` time
even when VS Code is not running.

The extension surfaces priority-graded findings (P0 Praise / P1 Info / P2
Warning / P3 Critical) inline in the editor — comment threads, Problems
panel diagnostics, CodeLens, and a summary webview. P3 findings block the
commit.

Source layout, architecture, and the pre-commit hook design are documented
in [blueprint.md](blueprint.md). User-facing setup and settings reference
are in [vscode-extension/README.md](vscode-extension/README.md).
