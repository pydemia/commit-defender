# Standalone review

Manual reviews use the shared GCR core over captured local source. Standalone mode does not contact a GCR server or upload local knowledge to one. The selected model receives approved source and active local knowledge as review context.

## Select an account

Run **Commit Defender: Select Account Provider and Model** and choose Codex, Claude Code or Antigravity in the native VS Code picker. Claude Code and Antigravity also offer a reasoning selection before applying the provider. Cancelling keeps your current account choice. Use a CLI model alias/ID accepted by your account or select CLI default. Set `codexPath`, `claudeCodePath` or `antigravityPath` in User Settings if the corresponding executable is not found. Workspace settings cannot select another executable or model.

Claude Code requires a native CLI supporting `--safe-mode`. Captured source is supplied through stdin; tools, hooks, MCP, skills and session persistence are disabled. Antigravity requires the **agent CLI** (`agy`), rather than an IDE launcher. It runs a private temporary main agent with no tools, skills, plugins or MCP servers. Both retain their CLI-owned authentication; the extension does not copy tokens. Reviews retain exact captured read IDs and use the same report validation as Codex and API reviews. Non-success, missing final output, invalid source evidence, timeout and cancellation cannot be reported as completed.

Gemini CLI has been removed from account/model selection and login menus. Legacy settings are retained. Select Antigravity explicitly; any authentication migration is performed by the first-party CLI, not by this extension. Google Gemini API-key review remains available.

Account support here concerns explicit captured-source review, including review with pulled central context. The independent automatic service and review conversation still have their existing Codex restrictions. No new provider is silently substituted for those paths. New adapters reuse the existing Windows Job Object / POSIX process-group handling. Native account execution on this release is verified on macOS; a permitted native executable alone does not establish Windows/Linux CLI verification.

The fixed-source executor has macOS, Windows, and Linux paths and accepts Codex
CLI `0.153.4` or `0.154.0` after executable and capability checks. Windows
ARM64 was actually verified with `0.153.4`; W04 also verified the frozen packages
on macOS ARM64 without another model call. See [Windows native support](windows-native.md) before
treating a permitted CLI version as a tested OS/CPU combination. Codex uses the
selected model and checks its reasoning capability against the CLI catalog.
Azure OpenAI, OpenAI, Anthropic and Gemini API reviews use the existing
destination-bound model credential. OpenAI and Azure accept a nonempty
reasoning setting; leave it empty for Anthropic and Gemini. Claude Code, Gemini
CLI and Antigravity retain their existing login and commit-message support;
this release does not claim fixed-source review support for those CLI adapters.
An unsupported selection produces an error without switching providers.

Linux development packages require the existing account's owner-only regular
`auth.json` and an owner-controlled Codex home with hard-link support. The
executor exposes the same file in a temporary private home; it does not copy
credentials or import global instructions. Keyring-only Codex accounts fail
closed and are not exported to plaintext. Linux Secret Service remains required
for the extension's own encrypted history/credentials. Actual Linux account
review and Extension Host validation are pending; see [platforms](platforms.md).

Repository account settings do not authorize an executable, model or profile. Existing values are preserved. Select the account again in User Settings when migrating a workspace that previously kept these choices in `.vscode/settings.json`.

## Run and inspect a review

Use the existing Analyze Current File, Analyze Staged Files, Analyze Directory or Analyze Repository commands. Staged reviews capture the index; other commands capture saved working-tree files. The core can read captured base and related repository source through its limited source tools. Unsaved editor changes are not part of the captured view.

Preparation runs in a worker. The status bar can cancel preparation or execution. The model-run limit defaults to 120 seconds for one file and 360 seconds for multiple files, with a maximum of 600 seconds. Preparation has a separate limit of the same duration. Cancellation waits for owned resources to close. `maxTokens` limits API output. It does not impose an output-token cap on Codex.

The summary preserves incomplete, failed and cancelled outcomes. Standalone findings are advisory. It shows the source/context hashes, criteria revisions, source-read observations, anchor checks and evidence assessment. A source-read observation records a returned range; it does not claim a test was executed. Changed editor content invalidates inline source positions.

Selected source bodies are retained in a bounded in-memory cache for navigation after the worker closes. They are not added to stored reports. After a restart or cache eviction, navigation is available only when the recorded source can still be recovered with its matching hash; otherwise run a new review.

## Local Memory and Skills

Run **Commit Defender: Local Memory and Skills**. Choose this worktree or the current profile. New entries start as candidates. Edit their body, applicability, rationale and expiry, then activate the entries you want reviews to use. Skills provide review guidance and cannot grant execution permissions.

Changes use revision checks. If another CLI or extension process changed the same record, refresh before retrying. Deactivation, archival and deletion affect subsequent reviews. Existing reports retain the context they captured; their summaries check whether the local entries they used still match active revisions. Newly added entries are considered by the next review.

Entries and history use the shared encrypted OS-backed store. An unavailable credential store prevents access rather than falling back to plaintext. `commitDefender.localProfile` defaults to `default`, matching the CLI profile. Repository data is also separated by repository and worktree identity.

**Refresh Local History** reloads reviews shared with the CLI. Reloading history does not automatically restore editor diagnostics. Reopening a summary checks the local entries it used; returning focus to the window checks them again. Export explicitly creates a new plaintext JSON file at your chosen location. Import verifies an exported record and creates a new candidate in the selected scope.

Stage-triggered review is disabled on new installations. Its existing user opt-in remains advisory. The legacy pre-commit hook is separate. Its API credentials use the [model credential migration](model-credentials.md); opt-in automatic reviews use the independent shared-core service described in [Automatic reviews](automatic-reviews.md).
