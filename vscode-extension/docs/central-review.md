# Central review in Commit Defender

Manual reviews can use a signed GCR knowledge snapshot together with active local Memory and Skills. Source, base and related files are captured by the shared review core. The model runs through the selected local Codex account; the central API key grants access to review knowledge.

The current executor supports macOS, Codex CLI `0.153.4` or `0.154.0`, `gpt-6-astra` and `xhigh`. Choose the account and model in User Settings. New installations remain standalone until you select a central connection.

## Connect a worktree

Open **Commit Defender: Central Review Connection**, then **Connect with API key…**. Select the public connection JSON supplied by your server administrator, check its server/tenant/repository and public signing-key fingerprints, and enter a key issued for the `commit-defender` client. The key must permit `knowledge:read` for that repository. A `gcr-cli` key cannot authorize this client.

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
| Connection status | Shows server, tenant, repository, user, API key expiry, signed bundle release/hash and refresh/offline deadlines. No model call. |
| Synchronize knowledge | Authenticates and verifies a complete snapshot before activating it. No model call. |
| Use signed offline knowledge | Explicitly selects the existing signed cache while the connection and lease remain valid. |
| Use standalone review | Uses local knowledge and retains the saved central connection. No central request for the review. |
| Disconnect selected connection | Disables the cache and removes the local API key. The selected mode remains centralized so the next review explains the disconnection. Choose standalone or reconnect to continue. |

Online preparation uses a fresh verified cache or synchronizes it when required. The signed online refresh window is at most five minutes. Scheduled background sync, backoff and automatic fallback are not implemented in this checkpoint. Offline selection does not bypass key expiry, lease expiry or a previously confirmed 401/403. Model unavailability is reported separately from central authentication and cache problems.

Each completed, partial or failed central report uses a separate encrypted history namespace bound to server, tenant, repository and user. History refresh restores only the selected audience/profile/worktree; an active connection is required. Standalone and other-user reports are excluded. Disconnect preserves authored local Memory/Skills and does not upload them on reconnect.

Status and report provenance are read-only. This checkpoint does not add central knowledge editing or bundle export. The provider-based pre-commit hook retains its existing separate behavior.

## Verification scope

The macOS packaged worker has performed an actual Astra/xhigh central review using a synthetic HTTPS publisher and OS-backed credentials. Tests cover local/central composition, history isolation, offline operation and cancellation after disconnect. A real VS Code Extension Host verifies activation and command registration; the connection dialog flow is exercised with a VS Code API mock and real HTTPS transport. Visual inspection and PRISM-DEV server integration are separate checks. This development build has not been published to Marketplace.
