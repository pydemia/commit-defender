# Commit Defender architecture

Commit Defender is a local review client. GCR supplies optional history and review instructions; the user's selected provider supplies model execution. [Feature specification](features.md) lists the current supported operations and [How-to](how-to.md) shows their use.

## Components

| Component | Responsibility |
| --- | --- |
| Extension Host | Commands, account/connection selection, source selection, status/cancel, original/result views |
| Standalone review worker | Bounded preparation and execution outside the UI thread; cleanup before returning |
| `@gcr/client-contract` | Validated source, knowledge and result contracts; projection into CD's existing result UI |
| `@gcr/client-core` | Captured Git source, local/central context, policy budgets, scoped encrypted stores and request journal |
| `@gcr/client-executors` and local API adapters | User-selected provider authentication, source tools, model responses and failure classification |
| Private bundled service | Explicitly enabled automatic reviews, independent queue, snapshots and recovery |
| Legacy hook / Python package | Separate compatibility paths; not the central reader or shared-core background service |

Client libraries and the service are shipped as version-pinned artifacts. Vendor manifests and provenance record upstream source commits and hashes. The extension bundles client code; it does not fetch executable code from a GCR knowledge bundle or replace a global CLI.

## Review data flow

```text
local Git source/base ─────┐
local active Memory/Skills ├─→ immutable review context → selected provider → local report
GCR signed read cache ────┘                                      │
                                                               └─ bounded fixed-source reads
```

The extension captures the index for staged reviews or saved working-tree bytes for other manual scopes. Related callers/contracts/tests can be read as captured supporting context. Model source tools do not provide a shell, dependency installer or test runner. The response must refer to issued source reads and valid captured anchors before it can become a completed report.

GCR knowledge follows a different transport from the model call. The GCR transport performs authenticated GETs using server-known repository/PR/history IDs, cursor and revision. It does not send local filenames as search queries, local code/diffs, results, questions, conversations or private memories. The provider receives the authorized source and context necessary for review; “local reviewer” describes where the client runs, not a guarantee of on-device inference.

## Identity, storage and cache

A local profile identifies separately owned Memory/Skills and credentials. Repository and worktree identities further separate source/history. Central records also bind server, tenant, repository and user; a credential issued for GCR CLI is not interchangeable with a CD key. Effective Git remotes are compared locally with the authorized central repository identity.

Public connection JSON contains server identity, signing public keys and optionally the HTTPS CA. It does not contain the reader secret. Model API keys and central reader keys use separate destination/scoped encrypted storage with OS-backed wrapping keys. Codex owns its account login. No unavailable key store falls back to plaintext. Explicit export is a separate plaintext operation.

Central bundles have signatures, content hashes, audience and release/authorization metadata. History pages have a separate encrypted cache under the same connection authority. During a review, selected context is pinned; a later publication cannot replace its contents mid-run. A changed source hash, guidance revision or thread revision prevents mixing historical material. Missing optional original history can leave a basic review available; loss of authority cannot authorize reuse of central material.

Online freshness and signed offline lease are separate deadlines. The current server uses a five-minute online manifest limit. Known revocation, expired authority, invalid signatures and identity-unavailable responses block central use. Offline clients cannot learn a new remote revocation before synchronizing. Results identify online, cached or explicitly local fallback execution.

## Manual, automatic and legacy execution

Manual reviews remain available without enabling a trigger. Automatic work is registered explicitly and defaults off. The independent local service keeps source snapshots and its request journal so a durable enqueue can outlive Git or VS Code; queued work is not equivalent to a completed review. Existing hooks run with their own arguments/output/exit policy before the advisory adapter. Manual and background paths coordinate admission and reuse of identical source/context/executor requests.

The background service currently registers supported Codex execution, whereas manual review also has API adapters. It reads the selected model/reasoning configuration. The legacy hook can retain its own blocking policy and provider behavior; it must not be described as the same run as a modern manual review.

## Results and provenance

Reports preserve terminal status, source/context hashes, selected guidance revisions and model identity. Historical source evidence includes original URL/ID, body and observation hashes, API revision and reply hashes. Overall summaries explain whether supplied historical guidance applies, is already satisfied, is excluded or was not used. The UI retains that explanation alongside per-file summaries.

Source-read observations prove what source was returned, and anchor validation proves positional consistency. Neither proves test execution. An input provenance entry alone does not establish that a historical comment informed the model's judgment. Saved reports remain records of their captured version; changed source and invalidated context are not silently relabeled as current.
