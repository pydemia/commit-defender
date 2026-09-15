# How-to and review examples

Use [Installation](installation.md) to prepare the extension and model. These examples describe workflows and expected interpretation; they do not claim that an arbitrary project will receive a particular model answer.

## Review a small staged change

Save an edit, inspect `git diff --cached`, then run **Commit Defender: Analyze Staged Files**. If only part of a file is staged, the review uses that index version even when the editor contains later changes. Analyze Current File/Directory/Repository uses saved working-tree content; unsaved buffers are not captured.

Read the report status first. Follow an inline finding to its recorded source, compare the caller/contract and inspect counter-evidence. Open **Commit Defender: Show Summary Panel** for the overall result and evidence. If the file has changed since review, old line positions must not be treated as current diagnostics. Reopening history does not automatically restore old diagnostics.

**Commit Defender: Cancel Analysis** cancels preparation/execution and waits for owned resources to close. A cancelled review remains cancelled. API output-token limits and model-run time limits are different controls; Codex has no hard output-token cap in this adapter.

## Reuse an earlier PR comment

Suppose a previous review recommended keeping request-only cross-field validation in a Pydantic validator, with an explicit exception for database state and authorization checks.

1. In GCR, open Review History and inspect the original comment, replies and body versions. An administrator can create source-linked guidance with applicability and counter-evidence, then activate/publish it. Reading the original requires no memory approval.
2. In CD, use **Central Review Connection → Browse PR review history** to read the same material. **View downloaded review knowledge** shows the current signed Skill/prompt/guidance snapshot.
3. Review a relevant staged change. CD chooses applicable material locally and pins source/guidance versions. Its GCR requests contain server-known IDs/cursors/revisions, not your file contents or a local search question.
4. Inspect both the Overall Summary and **Review criteria used / Evidence**. Context entries prove that material was supplied. A model-authored explanation linking that source to current code is separate evidence of its assessment.

| Change | What a useful review should distinguish |
| --- | --- |
| Move required validation into a helper that no request entrypoint calls | The current caller path misses validation; the old comment helps identify the contract to check |
| Restore the validation as an active model validator | The requirement is already satisfied; do not repeat the old criticism merely because it exists |
| Add a check using stored database state | Respect the guidance's exception; do not demand moving every validation into request parsing |

Provide callers, contracts and boundary tests as readable context. A comment saying “fixed”, a merged PR or a resolved/outdated thread is not proof of the current implementation. Downloaded guidance does not run those tests or grant shell access.

## Work with a cache or without GCR

**Connection status** shows the current binding, last successful synchronization, online refresh time and signed offline lease. **Synchronize knowledge** downloads an authorized snapshot without calling the model. Online and offline validity are different: the current server's five-minute online manifest lifetime can end a long pinned review.

Use **Use signed offline knowledge** only when the selected cache is still valid. History pages must already be cached for the current connection generation. Offline mode cannot bypass expired keys, invalid signatures or known revocation/identity failure. It cannot discover a new server revocation without synchronization.

Choose **Use standalone review** to review with local/built-in knowledge while retaining the connection. Explicit fallback policies can use local knowledge after an ordinary availability failure. Such a result is labeled as local fallback and does not demonstrate compliance with central policy. Neither choice changes your model provider.

## Add a local review instruction

Open **Commit Defender: Local Memory and Skills**, choose this worktree or profile, create a candidate, and record its purpose, applicability and counter-evidence. Activate it when ready. It is stored locally and is not uploaded on connection or synchronization. Edits affect subsequent reviews; saved results retain the context they used.

For example, a rule about a repository's nullable API field should state where it applies and which existing validation would refute the concern. Avoid making the instruction a demand to emit a finding. Import/export is explicit; exported JSON is plaintext even though the local store is encrypted.

## Opt into automation

After verifying manual review, open **Commit Defender: Automatic Reviews** and enable only the desired trigger. Save, Stage, Commit and Push default to off. The background service uses the selected account/model settings and runs independently; queue admission and a completed model review are separate events. Existing legacy hooks may run first and retain their own blocking policy. See [Automatic reviews](automatic-reviews.md).

**Local Review Activity** reads saved local history for a selected period without model calls or uploads. Counts reflect saved attempts/findings, not unique confirmed defects, token usage or provider billing.

## Diagnose the failing boundary

| Symptom | Check | Action |
| --- | --- | --- |
| No original comments | Repository, PR collection coverage and reader access | Read existing history first; ask a manager for a bounded collection only if needed |
| GCR unavailable | Connection status and allowed offline/fallback policy | Use only valid cached or explicitly local context |
| 401/403, revoked or identity unavailable | Key lifetime and current user/tenant/repository access | Restore authority and authenticate/sync; do not reuse denied cache |
| Provider unavailable or unsupported | User Settings, CLI version, account catalog or model credential destination | Fix the selected provider, without substituting the GCR reader key |
| Cancelled near online refresh deadline | Pinned manifest expiry and run duration | Synchronize normally and retry within a usable lease; do not relabel the old attempt |
| No new commands after installing a VSIX | Installed version versus the already open Host | Reload when convenient after active work finishes |
| Old findings do not navigate | Source hash/cache availability after edits or restart | Inspect the recorded version or run a new review |

Use the Commit Defender Output channel and report problem codes. Avoid copying credentials or complete private source into an issue when public version/status information is sufficient.
