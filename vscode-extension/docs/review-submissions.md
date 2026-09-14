# Submit feedback from a saved review

Commit Defender 2.4.0 adds **Submit feedback** to the review summary and **Submit Review Feedback** to the command palette and review history. Select a central connection for the current trusted workspace and profile first. The server key needs `feedback:submit` for feedback or `reviews:submit` for review status and counts; the default read-only key cannot submit.

Choose correction / false positive, exception request, or new judgment. Write the message and optionally select a finding. File path, line range, and source hash are included only when you select **Include the selected finding’s…**. The selected finding may also carry its central rule reference. A standalone review does not claim a central rule or snapshot.

**Preview submission** shows the destination server, tenant, repository, user, visibility, and exact public payload. Check the content and confirmation box before choosing an action:

- **Submit now** saves the confirmed payload locally and sends it to the selected server.
- **Save to outbox** keeps an encrypted local entry without sending it. Opening the panel, refreshing, and knowledge synchronization do not send entries.
- **Save feedback as a local memory candidate** stores the feedback message separately in repository Local Knowledge. It starts as a candidate and needs explicit activation. This action does not submit feedback to the server.

Open an outbox entry to inspect and confirm its original payload before retrying. Retries preserve the request ID; a stored receipt is reused. A connection error may leave delivery unconfirmed even if the server accepted the request. **Cancel local retries** cannot retract a server receipt. The outbox and server intake retain submissions for 30 days. No source bodies, review prose, conversation history, or local Memory/Skill bodies are added automatically; text you put in the message is shared as written.

Submissions are visible to authorized repository reviewers and labeled `client-reported`. A receipt means the server received the payload. It does not approve a criterion or exception. The central intake review, conversion to a candidate, approval status, and subsequent bundle synchronization are still being implemented under P08-C05. Until those are connected, the extension displays delivery status only.

A changed workspace trust, review configuration, profile, or selected connection closes the panel. Each action checks the saved report and connection again. Review history from another workspace, profile, or central audience cannot be submitted from this panel.

## Verification

`npm run test:review-submission` exercises the real shared submission queue and HTTPS transport with a task-owned TLS server and synthetic reviews. It covers explicit confirmation, no upload on preview/save, identical retry payloads, rejected and unconfirmed delivery, disconnect, saved-report ownership, central snapshot references, and local candidate creation. It does not call a model or a production server.

The native test uses an isolated VS Code window and its actual extension command, webview, OS credential store, and HTTPS fixture:

```sh
./node_modules/.bin/esbuild test/review-submission-host.ts --bundle --platform=node --target=node18 --format=cjs --external:vscode --outfile=out-test/review-submission-host.cjs
VSCODE_EXECUTABLE_PATH=/absolute/path/to/VSCode/executable \
CD_SUBMISSION_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node test/run-review-submission-host.mjs
```

The runner leaves a live host alone on an observation timeout. Confirm its process has stopped before cleaning a retained fixture or starting another run. `CD_SUBMISSION_EXTENSION_PATH` can point to an extracted VSIX for artifact activation. Public Marketplace publishing remains a separate release gate.
