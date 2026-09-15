# Standalone review

Manual reviews use the shared GCR core over captured local source. Standalone mode does not contact a GCR server or upload local knowledge to one. The selected model receives approved source and active local knowledge as review context.

## Select an account

Run **Commit Defender: Select Account Provider and Model** and choose the provider and model in User Settings. Set `commitDefender.reviewReasoningEffort` separately; changing the account does not overwrite it. Set `commitDefender.codexPath` in User Settings if the supported executable is not found on PATH. Use **Commit Defender: Sign in with Codex** to open the existing CLI login flow.

The current fixed-source executor supports macOS and Codex CLI `0.153.4` or `0.154.0`. It checks the executable and capabilities before a model call. Codex uses the selected model and checks its reasoning capability against the CLI catalog. Azure OpenAI, OpenAI, Anthropic and Gemini API reviews use the existing destination-bound model credential. OpenAI and Azure accept a nonempty reasoning setting; leave it empty for Anthropic and Gemini. Claude Code, Gemini CLI and Antigravity retain their existing login and commit-message support; this release does not claim fixed-source review support for those CLI adapters. An unsupported selection produces an error without switching providers.

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
