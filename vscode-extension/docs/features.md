# Feature specification

This document describes the current source, not every version previously published to Marketplace. [Installation](installation.md) defines platform/provider requirements; [Architecture](architecture.md) describes the data boundaries.

## Review and result contracts

| Surface | Input and action | Result and boundary |
| --- | --- | --- |
| Analyze Staged Files | Current Git index, including partial staging | Fixed source/base; later editor bytes do not replace the reviewed snapshot |
| Analyze Current File / Directory / Repository | Selected saved working-tree files | Exclusions and source limits apply; unsaved buffers are not reviewed |
| Cancel Analysis | Active preparation or run | Owned work stops; cancellation is recorded, not converted to clean success |
| Summary / Problems / inline findings | Validated local result | Advisory findings, coverage/status, anchors, source/context provenance |
| Show History Entry / Refresh Local History | Selected profile/worktree/audience | Encrypted saved reports; refresh does not start a model or restore stale diagnostics |
| Local Memory and Skills | Locally authored candidate with scope and revision | Activation affects later reviews; no GCR upload |
| Discuss review | Saved report and authorized captured source | Local conversation using the selected provider; incomplete source/answers remain explicit |
| Local Review Activity | Saved local results over a period | Counts, recorded duration and provenance; token usage/billing is unknown |

`completed` means the required review response/coverage checks completed. It is not a passed test suite or proof that no defect exists. `partial`, `needs-context`, `failed`, `cancelled`, `superseded` and unavailable execution retain distinct meaning. Source-read evidence records returned text ranges; anchor checks validate positions.

## Central read contracts

| Surface | Access and input | Outcome |
| --- | --- | --- |
| Connect with API key | Trusted public connection JSON + CD `knowledge:read` key | Scoped binding and verified signed bundles; model choice is retained |
| Connection status | Existing connection | Audience, cache/hash, expiry and sync metadata; no model call |
| Browse PR review history | Server-known PR/source IDs and cursors | Originals, replies, body versions, observations, linked guidance; no memory approval for raw history |
| View downloaded review knowledge | Authorized signed snapshot | Read-only prompts, Skills, criteria and memories |
| Review with central knowledge | Local relevance selection and fixed versions | Source-linked guidance and bounded originals/replies in local model context |
| Use signed offline knowledge | Valid cache, binding, key and signed lease | Only cached authorized pages; known revocation cannot be bypassed |
| Disconnect | Selected connection | Stops central use and retains separately authored local material |

At most five selected source-linked guidelines expand into originals, with at most ten replies per source. The result records whether replies were complete. Changed source/guidance/thread versions are not mixed. The history cache holds at most 128 distinct pages per cache state; only the current connection generation is readable. Natural-language applicability and counter-evidence are evaluated against current source, rather than literal string matches.

Local source, diffs, questions, review results, conversation and private Memory never cross the GCR read boundary. They may be sent to the selected model provider as authorized review context. There is no central model proxy or executable downloaded-check runner.

## Providers and execution

| Provider | Fixed-source manual review | Authentication / constraints |
| --- | --- | --- |
| Codex | Supported on macOS | Existing CLI account; verified 0.153.4/0.154.0, model/effort capability checks |
| OpenAI / Azure OpenAI | Existing API adapters | Destination-bound encrypted API credential, explicit model/deployment |
| Anthropic / Gemini API | Existing API adapters | Destination-bound credential; leave reasoning setting empty |
| Claude Code / Gemini CLI / Antigravity | Not supported by this fixed-source path | Separate sign-in/commit-message integration does not imply review support |

No provider is silently substituted. Central connection state does not select a server model. OS-backed storage supports macOS Keychain and Linux Secret Service; Windows storage is not supported in this build. Actual G03/G04 model evidence is narrower than the full adapter support surface and is recorded in the execution documentation.

## Automatic and legacy paths

All automatic triggers default off for new installations. Save/Stage/Commit/Push use explicit User Settings/worktree choices and the independent local service. Existing trigger preferences are preserved. Save source classification, debounce, admission limits, queue deduplication and stale-source cancellation are described in [Automatic reviews](automatic-reviews.md).

The automatic service currently requires the supported Codex account executor; it does not imply that every manual API provider is available for background registration. It uses the chosen model and reasoning settings, not a central model account. Commit/Push adapters preserve existing hooks and do not block a successful original hook because of new advisory findings.

The legacy pre-commit hook and Python CLI retain their separate policies. P0–P3 presentation in a manual report does not make every P3 block Git. Do not interpret legacy skip markers, prompt knobs or hook credentials as a permission bypass for fixed-source review.

## Excluded or limited behavior

The current workflow does not install arbitrary dependencies, execute downloaded validation code, run tests through P11, upload personal local data to GCR or publish Marketplace releases. Signing into an account, connecting GCR or opening history does not opt into additional automatic runs. An already open Host may need a user-selected reload after an upgrade. Online manifest expiry can interrupt a long review and is not relaxed for convenience.
