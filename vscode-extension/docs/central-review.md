# Central review in Commit Defender

Central integration is one-way. The extension downloads central reviews, review knowledge and prompts and applies them with the configured local model. Local source, results, feedback, conversations and personal Memory stay on this computer. No central executor, result submission or feedback upload is offered. Historical encrypted outboxes are retained locally and cannot be sent by this client.

Manual reviews can use a signed GCR knowledge snapshot together with active local Memory and Skills. Source, base and related files are captured by the shared review core. The model runs through the selected local Codex account; the central API key grants access to review knowledge.

The current executor supports macOS, Codex CLI `0.153.4` or `0.154.0`, `gpt-6-astra` and `xhigh`. Choose the account and model in User Settings. New installations remain standalone until you select a central connection.

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

The macOS packaged worker has performed an actual Astra/xhigh central review using a synthetic HTTPS publisher and OS-backed credentials. Tests cover local/central composition, history isolation, offline operation and cancellation after disconnect. A real VS Code Extension Host verifies activation and command registration; the connection dialog flow is exercised with a VS Code API mock and real HTTPS transport. Visual inspection and PRISM-DEV server integration are separate checks. This development build has not been published to Marketplace.

Reports show configured and effective modes separately: `Centralized · online`, `Centralized · cached` or `Standalone · fallback: <reason>`. A fallback does not change the saved connection or switch the model provider. Local fallback history remains locally owned, contains no central snapshot or entries, and is labeled as advisory without establishing central policy compliance. The selected connection's fallback results remain readable after central access expires. Reconnection never reruns or relabels an existing local result.

If identity verification succeeds but the first knowledge publication fails, a confirmed local fallback policy can retain the selected connection. The pending API key is removed; reconnect to restore central reviews. Cancelling connection setup never selects fallback automatically.

## View downloaded content

Open **Manage Central Review Connection → View downloaded review knowledge** to read the selected repository's signed snapshot. The view includes prompt instructions and documents, review criteria with applicability, counter-evidence and exceptions, shared review knowledge, and your centrally published memories. It shows all downloaded entries; each review selects relevant entries and records its own context.

The view is read-only. It refreshes knowledge when online freshness requires it and never invokes a model or uploads local content. Markdown and source references are displayed as text. Local Memory and Skills remain editable in their own view.

Connection changes in the manager close the view. The view also checks local access on focus, at signed lease expiry, and every 30 seconds while open. A changed selection or manifest, confirmed local revocation, or invalid cache closes it. An offline client cannot detect a server revocation before synchronization; the existing signed offline lease applies.
