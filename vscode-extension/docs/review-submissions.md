# Submit feedback from a saved review

Commit Defender 2.4.0 adds **Submit feedback** to the review summary and **Submit Review Feedback** to the command palette and review history. Select a central connection for the current trusted workspace and profile first. The server key needs `feedback:submit` for feedback or `reviews:submit` for review status and counts; the default read-only key cannot submit.

Choose correction / false positive, exception request, or new judgment. Write the message and optionally select a finding. File path, line range, and source hash are included only when you select **Include the selected finding’s…**. The selected finding may also carry its central rule reference. A standalone review does not claim a central rule or snapshot.

**Preview submission** shows the destination server, tenant, repository, user, visibility, and exact public payload. Check the content and confirmation box before choosing an action:

- **Submit now** saves the confirmed payload locally and sends it to the selected server.
- **Save to outbox** keeps an encrypted local entry without sending it. Opening the panel, refreshing, and knowledge synchronization do not send entries.
- **Save feedback as a local memory candidate** stores the feedback message separately in repository Local Knowledge. It starts as a candidate and needs explicit activation. This action does not submit feedback to the server.

Open an outbox entry to inspect and confirm its original payload before retrying. Retries preserve the request ID; a stored receipt is reused. A connection error may leave delivery unconfirmed even if the server accepted the request. **Cancel local retries** cannot retract a server receipt. The outbox and server intake retain submissions for 30 days. No source bodies, review prose, conversation history, or local Memory/Skill bodies are added automatically; text you put in the message is shared as written.

Submissions are visible to authorized repository reviewers and labeled `client-reported`. A receipt means the server received the payload. It does not approve a criterion or exception. Central reviewers can adopt feedback as a candidate or link it to a correction/exception request. Commit Defender 2.5.0 adds the follow-up actions below; the server must support the status endpoint (GCR alpha.47 or later).

A changed workspace trust, review configuration, profile, or selected connection closes the panel. Each action checks the saved report and connection again. Review history from another workspace, profile, or central audience cannot be submitted from this panel.

## Check approval and review again

For a submitted outbox entry, **Check central review status** retrieves its current criterion state and revision, intake note, and correction/exception decision using `knowledge:read`. **Open central criteria** opens the configured server’s criteria page. Both require the original submitting user and client identity. Merely opening the panel does not fetch status.

Choose **Synchronize central policy** to download and verify the current signed policy. An approval by itself does not enable re-review: the exact criterion revision/hash and, when relevant, approved exception must be present in that policy. A correction acknowledgement needs a subsequent criterion revision. Pending/rejected feedback, inactive criteria, and expired/revoked/future or superseded exceptions remain unavailable for this action.

**Review these files again** starts a separate review only after this explicit synchronization. It reads the current staged versions for an original index review, or current working-tree versions of the original report’s file paths otherwise. It uses the selected model and pins the policy snapshot confirmed in this panel. Source applicability still follows the criterion and exception scopes. The host rechecks status and the snapshot before launching; a changed policy requires a new status check and synchronization. This path pauses on unavailable central policy and does not fall back to local-only review. Closing the feedback panel or changing its selection cancels an in-flight follow-up review.

After receipt retention expires, status may return unavailable even though an adopted criterion remains in central history. Status retrieval, synchronization and re-review do not send another feedback payload.

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

The opt-in `test/run-review-followup-live.mjs` runner exercises the packaged extension against a real publisher and launches one explicit current-account Astra/xhigh follow-up review. It requires `CD_FOLLOWUP_ALLOW_MODEL=1` and an operator-supplied `CD_FOLLOWUP_FIXTURE_MODULE`; it is excluded from `npm test`. The fixture module exports `setup()` and `cleanup()`. Setup returns a private `configuration` (`config`, `token`, `userId`) and an `adopt()` operation that uses the authorized central workflow and returns `ruleId`/`snapshotId`. The runner passes configuration to the native host in a temporary mode-0600 file, submits from the actual webview, synchronizes, clicks re-review, and preserves the terminal report before assertions. It removes owned local keys/files and calls fixture cleanup only after the native host has exited. A running host is retained on an observation timeout and must not be silently retried.

On PRISM-DEV alpha.47 with this 2.5.0 VSIX, that native path completed one Astra/xhigh review using the newly activated criterion and synchronized snapshot. The initial report and four evaluation cases were synthetic; the follow-up review was an actual model call. Central adoption/evaluation/activation used the real authorized HTTPS API. CD submission, status retrieval, synchronization and re-review used the actual VS Code webview. The model inspected source/base, caller and test files and found the tenant cache-key regression; it did not execute tests.
