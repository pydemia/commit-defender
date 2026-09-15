# Central review in Commit Defender

Central integration is one-way. The extension downloads central reviews, review knowledge and prompts and applies them with the configured local model. Local source, results, feedback, conversations and personal Memory stay on this computer. No central executor, result submission or feedback upload is offered. Historical encrypted outboxes are retained locally and cannot be sent by this client.

Manual reviews can use a signed GCR knowledge snapshot together with active local Memory and Skills. Source, base and related files are captured by the shared review core. The model runs through the selected local provider; the central API key grants access to review knowledge.

Supported review providers and capability limits are listed in [Standalone review](standalone-review.md). Connecting to GCR does not change the provider, model or reasoning. Choose the account and model in User Settings. New installations remain standalone until you select a central connection.

## Connect a worktree

Open **Commit Defender: Central Review Connection**, then **Connect with API key…**. Select the public connection JSON supplied by your server administrator, check its server/tenant/repository and public signing-key fingerprints, and enter a key issued for the `commit-defender` client. The key must permit `knowledge:read` for that repository. A `gcr-cli` key cannot authorize this client.

You can download this public JSON and issue the key from the server's profile page. The connection notification remains cancellable while the server publishes the repository's first knowledge bundles. Initial synchronization waits up to 60 seconds and retries ordinary HTTP 503 responses with increasing delays. The connection becomes active only after all signed components are verified. Authentication rejection or invalid content ends the attempt; cancellation and failure remove the pending credential.

The configuration file has this shape; the IDs, public key and optional CA must come from the trusted server configuration:

```json
{
  "serverUrl": "https://review.example.internal/",
  "serverId": "server-id",
  "tenantId": "tenant-id",
  "repositoryId": "repository-id",
  "trustedKeys": [{ "id": "signing-key-id", "pem": "PUBLIC ED25519 PEM" }],
  "ca": null
}
```

The API key is entered in a password box and stored in the OS credential store. It is not written to VS Code settings, hook configuration or worker messages. The connection and selected mode are scoped to the local profile and Git worktree. Repository settings cannot choose an account or connection. Changing the selected connection cancels the current review before replacing its displayed results.

Use the existing **Analyze Staged Files**, **Analyze Current File**, directory or repository commands. Central policy/Skills and approved memories are combined with applicable local knowledge. The report shows the central audience and snapshot used, source/context hashes and finding evidence. Findings remain advisory.

## Connection commands

| Action | Behavior |
| --- | --- |
| Select connected repository | Selects an existing Commit Defender connection in this profile/worktree and requests online freshness. |
| Connection status | Shows server, tenant, repository, user, offline policy, API key expiry, signed bundle release/hash, last successful sync and refresh/offline deadlines. No model call. |
| Synchronize knowledge | Authenticates and verifies a complete snapshot before activating it. No model call. |
| Use signed offline knowledge | Explicitly selects the existing signed cache while the connection and lease remain valid. |
| Use standalone review | Uses local knowledge and retains the saved central connection. No central request for the review. |
| Disconnect selected connection | Disables the cache and removes the local API key. The selected mode remains centralized so the next review explains the disconnection. Choose standalone or reconnect to continue. |

Online preparation uses a fresh verified cache or synchronizes it when required. The signed online refresh window is at most five minutes. For explicitly selected online connections in trusted workspaces, background sync runs at startup and every five minutes with ±25% jitter. Returning to the window after sleep brings the next sync forward without overlapping requests. Temporary server or identity failures retry with exponential backoff (one second to a 60-second base, plus jitter). Standalone/offline selection, profile changes, workspace removal and extension shutdown cancel the affected loops. No model runs during sync. New connections default to `cache-then-standalone`, displayed in the connection confirmation. Existing selections without a policy retain `pause`. Choose **Offline and fallback behavior…** to change this worktree to `cache-then-standalone`, `cache-only`, `standalone` or `pause`. Ordinary outages may use a verified signed cache. If no cache is usable, the confirmed local fallback policies use only local/built-in knowledge with the same approved account executor. Identity failure, revocation and invalid signatures never authorize cached central data. Cache-only/pause stop instead. Busy, cancellation and corrupt local storage do not trigger fallback. Offline selection does not bypass key expiry, lease expiry, a previously confirmed 401/403 or an `IDENTITY_UNAVAILABLE` response. Identity failure pauses cached knowledge across restarts until an authenticated sync succeeds; it does not erase the key. A 304 updates the last successful sync time without extending the signed offline lease. Connection status shows the last success and cache problem. Model unavailability is reported separately from central authentication and cache problems.

Each completed, partial or failed central report uses a separate encrypted history namespace bound to server, tenant, repository and user. History refresh restores only the selected audience/profile/worktree; an active connection is required. Standalone and other-user reports are excluded. Disconnect preserves authored local Memory/Skills and does not upload them on reconnect.

Status and report provenance are read-only. This checkpoint does not add central knowledge editing or bundle export. The provider-based pre-commit hook retains its existing separate behavior.

## Verification scope

G03/G04 exercised the installed extension in a real VS Code Extension Host against PRISM-DEV history and published source-linked guidance. G04 used the existing Codex account with Luna/high on three fixed scenarios: an uncalled validation helper, its validator repair, and an unrelated stored-state check. All final reviews completed, with source-linked applicability explanations and no repeated old finding in the repaired/unrelated cases. These results are narrower than general provider/model coverage. Other supported adapters have contract regression evidence.

The recorded delivery was CD 2.11.3 with clients alpha.42 and private service alpha.37. This is a verification checkpoint, not a claim that an already open user Host or Marketplace has that version. See the repository's G04 execution record and the [installation checks](installation.md).

The current online manifest expires five minutes after issuance. Starting a new Host can still receive an existing manifest with less time remaining. A running review does not replace its pinned material just to extend the deadline; inspect Connection Status, synchronize normally and retry when appropriate. Signed offline mode has its own authority/lease checks and does not bypass revocation.

Reports show configured and effective modes separately: `Centralized · online`, `Centralized · cached` or `Standalone · fallback: <reason>`. A fallback does not change the saved connection or switch the model provider. Local fallback history remains locally owned, contains no central snapshot or entries, and is labeled as advisory without establishing central policy compliance. The selected connection's fallback results remain readable after central access expires. Reconnection never reruns or relabels an existing local result.

If identity verification succeeds but the first knowledge publication fails, a confirmed local fallback policy can retain the selected connection. The pending API key is removed; reconnect to restore central reviews. Cancelling connection setup never selects fallback automatically.

## View downloaded content

Open **Central Review Connection → View downloaded review knowledge** to read the selected repository's signed snapshot. The view includes prompt instructions and documents, review criteria with applicability, counter-evidence and exceptions, shared review knowledge, and your centrally published memories. It shows all downloaded entries; each review selects relevant entries and records its own context.

The view is read-only. It refreshes knowledge when online freshness requires it and never invokes a model or uploads local content. Markdown and source references are displayed as text. Local Memory and Skills remain editable in their own view.

Connection changes in the manager close the view. The view also checks local access on focus, at signed lease expiry, and every 30 seconds while open. A changed selection or manifest, confirmed local revocation, or invalid cache closes it. An offline client cannot detect a server revocation before synchronization; the existing signed offline lease applies.

## Git remote binding

New connections with Git remotes download the authorized repository identity using GET and compare it locally against effective fetch URLs. SSH and HTTPS forms can identify the same GitHub repository; forks, hosts, nonstandard ports and installation prefixes remain distinct. Credentials and URL query strings are removed before comparison and are never sent to GCR.

The connection status indicates whether remote mapping was recorded. Changing a remote stops use of that connection's knowledge, including offline reviews and open downloaded-content views. Inspect the remote and disconnect/reconnect to establish a new binding. Existing manual connections and repositories without remotes remain unverified until reconnected with a matching remote.

## 코드 변경에서 발행한 기준

2.9.4는 중앙 Git snapshot의 코드 변경을 출처로 하는 기준을 지원합니다. 중앙에서 평가·승인한 기준과 출처 ID·hash를 내려받고 로컬에 설정한 모델·계정으로 리뷰합니다. 중앙 코드 diff 원문을 받거나 로컬 코드·결과·피드백을 업로드하지 않습니다.

지식 계약 v3과 기존 v2 발행물을 읽을 수 있습니다. 이전 서버가 v3 요청을 HTTP 426으로 거절하면 같은 서버에 v2를 한 번 요청합니다. 인증 실패나 일반 장애에서는 이 협상을 하지 않습니다. 새 코드 출처가 포함된 발행물을 받으려면 2.9.4 이상이 필요합니다.

## Read PR history and reuse sources

Choose **Browse PR review history** in Central Review Connection. Select a PR and comment, then read the original, replies, body versions, thread observations or source-linked guidance. Next-page actions send the server cursor. Raw history is readable with the existing reader role and does not require memory approval. Downloaded HTML is displayed as text; the view runs no scripts.

Reviews select active guidance locally using file paths, language, symbols and branch scope. Natural-language contract conditions and counter-evidence are passed to the selected model for evaluation. Up to five selected source-linked guidelines can include their original comment and at most ten replies. The review records whether the reply page was complete. A changed guidance revision, changed source hash or mixed thread revision prevents that source from being added. Related source capture is optional; unavailable history does not remove the base review.

The captured context stays fixed for the run. The report records the central snapshot, guideline revision, original URL and ID, body hash, observation hash, history API revision and reply hashes. These are past observations, including claimed fixes and resolved threads. They do not establish that the current code is correct.

History pages use a separate encrypted cache under the same connection and signed access lease. At most 128 distinct pages are cached. Offline mode reads only pages cached for the current connection generation; synchronization can require fetching them again. Revoked, expired or invalidated material cannot be reused. Server outages, missing history, identity failures and failed model calls keep their separate outcomes. Only server-owned repository/PR/history IDs and cursors cross the history API boundary. Local source and review text go to the selected provider, never to GCR.


The Overall Summary records the model's application, already-satisfied, exclusion or non-use assessment with original source IDs/URLs, including zero-finding reviews. Review criteria and evidence show the captured versions separately. See [the three-case usage example](how-to.md#reuse-an-earlier-pr-comment).
