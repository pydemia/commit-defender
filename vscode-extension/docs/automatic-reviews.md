# Automatic reviews

Run **Commit Defender: Automatic Reviews** and choose a repository/worktree to toggle Save, Stage, Commit or Push independently. The choice is stored in extension user state. User Settings provide the defaults; `.vscode/settings.json` cannot enable automatic execution. All four triggers default to off, and manual review commands remain available.

Save reviews the saved working-tree files against HEAD. Typing alone does not trigger a review. Stage reviews the current staged changes after the index content changes, preserving partial staging even when the editor contains later edits. Linked worktrees use their actual index path, and workspace roots are tracked separately.

Events wait three seconds to combine repeated changes. Ready Stage requests take precedence over ready Save requests, and automatic work waits for an active manual review. Save defaults to a ten-minute minimum interval; automatic admission defaults to six review starts per hour for the same profile/worktree. Change `automaticSaveIntervalSeconds` or `automaticReviewsPerHour` in User Settings. These limits count review starts, not provider API calls or tokens. Manual reviews remain available when automatic work is deferred.

Auto Save and external file changes are excluded by default. Enable **Include Auto Save** or **Include external file changes** separately when needed. **Pause automatic reviews in this worktree** suspends that worktree; **Pause all automatic reviews** sets the global pause. Clear `commitDefender.automaticReviewsPaused` in User Settings to resume globally. A worktree selection cannot override the global pause.

Newer input cancels obsolete automatic work. Results update diagnostics, inline comments and review history without opening a summary or changing editor focus. Identical source, context and execution settings share the existing request journal and completed results with manual reviews. Source changes are checked again before model admission.

## Commit and Push

Commit captures Git's actual index, including the temporary index used by a partial commit or amend. Push captures each old/new object pair from pre-push stdin. Both submit encrypted snapshots to an independent local service. Git returns after durable enqueue; model completion is a separate result. The service continues when the hook or extension exits. Results appear in review history, refreshed while the extension is open.

Set `commitDefender.serviceNodePath` in User Settings to a Node.js 22+ executable if `node` on PATH is older or unavailable. The CLI and hook adapter are copied into private storage by content hash, so an extension directory update does not remove their entrypoints. The service uses the selected Codex executable, `gpt-6-astra` and `xhigh`. An existing service without automatic-budget support must be stopped before starting the bundled version. OS login startup is not yet configured.

Existing hooks remain at their original paths and are invoked with their arguments, environment, output and exit status. A private forwarding directory is selected by the repository's `core.hooksPath`; global configuration is not edited. With shared repository configuration, worktree routes restrict automatic enqueue to explicitly enabled worktrees. Existing worktree-specific configuration is used when enabled. Removing the final route restores the previous local setting. If another tool changes the forwarding files or hooksPath, removal reports a conflict and preserves those changes.

The original hook runs first. Its failure still stops Git and prevents automatic enqueue. Review findings, unavailable service or model failure do not block a successful original hook. `commitDefender.hookReviewWaitSeconds` optionally waits for a result (default 0, maximum 600 seconds); its timeout does not cancel the service job or alter Git's exit policy. An enqueue observation failure prints its request ID for reconciliation and is never automatically retried.

Hook resolution follows [Git's hook contract](https://git-scm.com/docs/githooks) and [hooksPath rules](https://git-scm.com/docs/git-config#Documentation/git-config.txt-corehooksPath). These adapters preserve the existing legacy Commit Defender hook too; enabling both can invoke that legacy review before the new background review. Disable the legacy hook explicitly if you no longer want its review/blocking policy.

## Current limits

Save and Stage still require VS Code to remain open. Their adapter establishes an index baseline on activation, so it does not replay edits made while the extension was closed. Whole-file unstaging and no-op index events are ignored; partial-hunk unstaging can still schedule a review. Open a nested Git repository as its own workspace folder to give it a separate event observer. Commit/Push currently require an online central selection when using centralized mode. User-wide token budgets and reconciliation UI for interrupted service jobs remain pending.

Select the account, model and review mode using the existing review settings. Enabling a trigger does not configure an account or grant additional source/tool access. An unavailable source or execution error is recorded in Commit Defender Output; automatic execution does not open account prompts.
