# Automatic reviews

Run **Commit Defender: Automatic Reviews** and choose a repository/worktree to toggle Save or Stage. The choice is stored in extension user state. User Settings provide the defaults; `.vscode/settings.json` cannot enable automatic execution. Both triggers default to off, and manual review commands remain available.

Save reviews the saved working-tree files against HEAD. Typing alone does not trigger a review. Stage reviews the current staged changes after the index content changes, preserving partial staging even when the editor contains later edits. Linked worktrees use their actual index path, and workspace roots are tracked separately.

Events wait three seconds to combine repeated changes. Ready Stage requests take precedence over ready Save requests, and automatic work waits for an active manual review. Save defaults to a ten-minute minimum interval; automatic admission defaults to six review starts per hour for the same profile/worktree. Change `automaticSaveIntervalSeconds` or `automaticReviewsPerHour` in User Settings. These limits count review starts, not provider API calls or tokens. Manual reviews remain available when automatic work is deferred.

Auto Save and external file changes are excluded by default. Enable **Include Auto Save** or **Include external file changes** separately when needed. **Pause automatic reviews in this worktree** suspends that worktree; **Pause all automatic reviews** sets the global pause. Clear `commitDefender.automaticReviewsPaused` in User Settings to resume globally. A worktree selection cannot override the global pause.

Newer input cancels obsolete automatic work. Results update diagnostics, inline comments and review history without opening a summary or changing editor focus. Identical source, context and execution settings share the existing request journal and completed results with manual reviews. Source changes are checked again before model admission.

## Current limits

VS Code must remain open. The independent background service and the new Commit/Push triggers are still under development; the existing pre-commit hook remains a separate legacy path. The adapter establishes an index baseline on activation, so it does not replay edits made while the extension was closed. Whole-file unstaging and no-op index events are ignored; partial-hunk unstaging can still schedule a review. Open a nested Git repository as its own workspace folder to give it a separate event observer.

Select the account, model and review mode using the existing review settings. Enabling a trigger does not configure an account or grant additional source/tool access. An unavailable source or execution error is recorded in Commit Defender Output; automatic execution does not open account prompts.
