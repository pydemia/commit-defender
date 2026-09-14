# Conversations about saved reviews

Open **Discuss review** in a review summary, use the conversation action on a local history entry, or run **Commit Defender: Discuss Review** for the latest report. Expand **Review summary and findings** and select a finding to prepare a question, then send it. Opening a conversation does not call the model.

Enter sends a message; Shift+Enter inserts a newline. When the model asks a confirmation question, select an option or type an answer and choose **Answer and resume**. The question is saved and the model process exits while waiting. Closing and reopening the conversation preserves the question and prior responses. Unanswered questions expire after 24 hours.

Source evidence opens the captured source or base in a read-only editor. It remains the version used by the original review even if the working file changes. Return to the conversation tab to continue. The model reads this saved source; it does not run tests, edit files, or commit changes.

**Cancel turn** stops the current conversation step and waits for its worker and model process to exit. A queued turn needs an explicit **Resume**. Opening or refreshing the view never restarts a model. A failed or cancelled step may retain conservative budget reservations; the displayed reservation is not a provider billing total.

The current integration uses the selected Codex account with `gpt-6-astra` and `xhigh`. Each turn retains the limits and source/context identity of its original review. A changed model, source exclusion policy, lower time limit, changed knowledge context, or confirmed central authorization revocation prevents continuation. Run a new review when the original context is no longer valid. Conversations remain encrypted in the selected local profile and repository/worktree scope. Central conversations also require the original central connection and audience.

New shared-core reviews preserve their source for conversations, including automatic review results produced with the bundled CLI. Older reports without a preserved conversation source cannot be opened as new conversations. Their current working files are not substituted for missing historical source. CLI conversation commands, MCP tools, and explicit central feedback submission are still being implemented.
