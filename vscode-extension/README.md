# Commit Defender

Commit Defender reviews local Git changes and shows source-linked findings in
VS Code: inline comments, CodeLens, Problems, and a saved review summary.
Review staged changes, a saved file, a directory, or a repository using your
own model provider. Add local Memory and Skills or connect to Git Code Reviewer
(GCR) to reuse earlier PR discussions and published review guidance.

Manual reviews work without a GCR server. Automatic reviews start disabled.
Reviews do not edit files, run tests, or create commits.

- [Get started](#get-started)
- [Choose a provider](#choose-a-provider)
- [Review and understand the result](#review-and-understand-the-result)
- [Memory, Skills, and earlier PR reviews](#memory-skills-and-earlier-pr-reviews)
- [Automatic reviews and hooks](#automatic-reviews-and-hooks)
- [Commands](#commands) · [Settings](#settings) · [Troubleshooting](#troubleshooting)

## Get started

For the GCR setup guide inside VS Code, run **Commit Defender: GCR Connection
Guide** or use the help icon in the Commit Defender sidebar. The bundled
[English guide](docs/central-setup.md) and [한국어 연결 가이드](docs/central-setup.ko.md)
cover reader keys, local model selection, synchronization, and the first
review. The command follows the VS Code display language (Korean or English
fallback), and both guides can be read offline.
The guide uses VS Code's built-in Walkthrough viewer, with rendered steps and
buttons for account selection, GCR connection, and Settings. Run **Commit
Defender: Open Settings** for the native settings UI, or use the sidebar gear.
Guide rendering does not depend on the Markdown preview Service Worker.

1. Install **Commit Defender** (`pydemia.commit-defender`) from Marketplace, or
   use **Extensions → Install from VSIX…** with a supplied package. Open a
   trusted Git workspace.
2. Run **Commit Defender: Select Account Provider and Model** from the Command
   Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`). Save choices in **User Settings**.
   Workspace settings cannot authorize another account, executable, model, or
   local profile.
3. For Codex, use an existing authenticated, supported CLI or run **Commit
   Defender: Sign in with Codex**. For an API provider, select its destination
   and model, then run **Commit Defender: Manage Model API Credential** and
   enter the key in the password box.
4. Save and stage a small change. Run **Commit Defender: Analyze Staged Files**.
   Use **Analyze Current File** for a saved, unstaged file.
5. Open **Show Summary Panel** and check the report status, findings, and source
   evidence. Enable automatic reviews after the first manual review works.

### Requirements and platform coverage

- VS Code **1.90+**, Git, and a trusted repository/worktree.
- A configured provider and an available OS credential store: Windows
  Credential Manager with local NTFS, macOS Keychain, or Linux Secret Service.
  Locked or unavailable storage does not fall back to plaintext.
- **Node.js 22+** for the independent automatic-review service. Ordinary
  extension workers use VS Code's runtime. The separate legacy hook requires
  Node.js 18+ on its PATH.
- A GCR connection and reader key only when using central history or guidance.

**2.12.6** provides x64 (amd64) and ARM64 packages for Windows, macOS, and Linux.
Codex account review was verified on Windows ARM64 and, for this release, in a
Linux ARM64 Extension Host on WSL2 with Codex `0.153.4` and
`gpt-5.6-luna / high`. The Linux run verified the finding, source evidence,
encrypted history, and process cleanup using the existing Linux login.

Earlier macOS account reviews used `0.153.4`/`0.154.0`, and macOS ARM64 package
regression passed in W04. The new macOS VSIX has not been run on a Mac. Linux
x64 isolation was tested with actual CLI binaries under Docker emulation.
Windows x64 and Intel Mac execution remain unverified; a package target alone
does not establish native execution coverage. See
[platform packages and Linux setup](docs/platforms.md) for prerequisites,
account-storage requirements, and the verification matrix.

See [Installation](docs/installation.md) for source builds and
[Windows support and recovery](docs/windows-native.md) for the verified
environment. Installing an extension does not reload an already open window.
Finish active work and reload when convenient.

## Choose a provider

| Provider | Review setup | Constraints |
| --- | --- | --- |
| Codex account | Select `codex`, an available model and reasoning effort; use the existing CLI login | Accepts CLI `0.153.4` or `0.154.0` after binary/tool checks; Linux account-storage requirements are described in the platform guide |
| OpenAI | Select `openai` and a model, then store its API key | Optional reasoning must be supported by the model |
| Azure OpenAI | Select `aoai`, resource endpoint, deployment name, and API version | The model field is the deployment name |
| Anthropic | Select `anthropic` and a model, then store its API key | Set review reasoning effort to an empty string |
| Google Gemini API | Select `gemini` and a model, then store its API key | Set review reasoning effort to an empty string |
| Claude Code account | Select `claudecode`, a CLI model alias or ID, and reasoning effort | Requires a native Claude CLI with `--safe-mode`; captured text only, no tools, hooks, MCP or saved sessions |
| Antigravity account | Select `antigravity`, an `agy models` slug or CLI default, and reasoning effort | Requires the Antigravity agent CLI; private no-tools agent, structured final status required; IDE launcher is unsupported |

Gemini CLI is no longer offered in account selection. Existing `geminicli` settings are preserved; choose Antigravity explicitly when migrating. Commit Defender does not migrate tokens or modify either CLI profile. The Gemini API provider remains available.

No provider or model is silently substituted. A GCR connection does not select
a server model or change your local account choice.

Example **User Settings** for Codex:

```json
{
  "commitDefender.aiProvider": "codex",
  "commitDefender.model": "gpt-5.6-luna",
  "commitDefender.reviewReasoningEffort": "high",
  "commitDefender.reviewMode": "standalone",
  "commitDefender.localProfile": "default"
}
```

Choose a model/effort available to your account. Set `commitDefender.codexPath`
if discovery does not find the intended executable. The extension does not
replace your global CLI or change its default account/model settings.

Example Azure destination settings, before storing the key:

```json
{
  "commitDefender.aiProvider": "aoai",
  "commitDefender.endpoint": "https://YOUR_RESOURCE.openai.azure.com",
  "commitDefender.model": "YOUR_DEPLOYMENT",
  "commitDefender.apiVersion": "2024-08-01-preview",
  "commitDefender.reviewReasoningEffort": ""
}
```

OpenAI, Anthropic, and Gemini can omit the endpoint to use their adapter's
default destination. Select an available model rather than treating an example
name as guaranteed account access.

**Manage Model API Credential** stores a key in encrypted local storage bound
to the profile, provider, endpoint, model/deployment, and API version. Changing
the destination cannot silently reuse an unrelated credential. Legacy
`commitDefender.apiKey` or hook values require explicit migration with this
command. Do not put keys in repository settings. See
[credential storage and migration](docs/model-credentials.md).

## Review and understand the result

### Choose the source

| Command | What is reviewed |
| --- | --- |
| Analyze Staged Files | The Git index, including partial staging; later editor changes do not replace it |
| Analyze Current File | The active file's saved working-tree content |
| Analyze Directory… | Eligible saved files in the selected directory |
| Analyze Repository | Eligible saved repository files, subject to confirmation and source limits |

The review captures source, base, and relevant repository context. Unsaved
buffers are not captured. Sensitive-file exclusions and source limits apply;
`excludePatterns` can narrow the selection. The model's source tools read only
captured material and cannot execute shell commands or edit files.

Use **Cancel Analysis** or the status bar to stop preparation or execution.
Cancellation waits for owned work to close. Cancelled and timed-out attempts
are not completed reviews with no findings.

### Findings, priorities, and history

Findings appear in inline comment threads, CodeLens, and Problems. The summary
groups findings by file and retains the **Overall Summary**, source/context
versions, review criteria, and evidence assessment.

| Priority | Meaning in the editor |
| --- | --- |
| P0 · Praise | Positive feedback |
| P1 · Info | Suggested improvement |
| P2 · Warning | A concern that warrants investigation or a fix |
| P3 · Critical | A serious defect or risk requiring attention |

Manual and automatic shared-core reviews are **advisory**. Their P3 findings
do not block Git. The separately enabled legacy pre-commit hook has its own
blocking policy.

Read the status before interpreting the finding count. `completed` means the
required response and coverage checks finished; it is not a passing test suite.
`partial`, `needs-context`, `failed`, `cancelled`, and `superseded` have distinct
meanings. A source-read entry proves that text was returned, not that a test
ran. Invalid evidence references are not accepted as successful review evidence.

When source changes, stale line positions are invalidated. **Refresh Local
History** reloads encrypted saved reports without a model call or automatic
restoration of old diagnostics. After a restart, source navigation requires
the recorded version to remain recoverable with its matching hash.

### Conversations and commit messages

Choose **Discuss Review** in a summary or history entry to ask about the report
and its captured source. Opening a conversation does not call the model;
sending a question does. Cancel a turn, reopen saved responses, or answer a
clarification with **Answer and resume**. Missing historical source or changed
authorization can prevent continuation. See
[review conversations](docs/review-conversations.md).

**Generate Commit Message**, also available from the Source Control wand
button, drafts a message from the staged diff into the SCM input box. Edit it
before committing; generation does not create a commit. Its account-provider
range is broader than fixed-source review, as shown above.

## Memory, Skills, and earlier PR reviews

### Local Memory and Skills

Open **Local Memory and Skills**, choose this worktree or profile, and create a
candidate. Record the instruction, applicability, rationale, counter-evidence,
and optional expiry. Activate it when ready. Edits or deactivation affect later
reviews; existing reports retain the context and revision they used.

For example, a validation rule should identify the request entrypoint and the
existing check that would satisfy it. It should not demand a finding solely
because an earlier review found a similar bug. Skills provide guidance and
cannot grant execution permissions.

Entries and history are encrypted and separated by profile and
repository/worktree. They are not uploaded to GCR. Import creates a candidate;
export explicitly writes plaintext JSON to your chosen destination. Legacy
`.commit-defender/**/SKILL.md` prompt loading belongs to the separate
provider-based path. Use **Local Memory and Skills** for shared-core reviews.

### Connect central history and guidance

1. Obtain the HTTPS server URL and a `knowledge:read` API key issued for
   **commit-defender** from GCR Profile → Clients. The key can allow multiple
   repositories. It is separate from your model credential.
2. Open **Central Review Connection → Connect with API key…** and enter the
   server URL and API key in the password box. Confirm the server; all allowed
   review sources connect automatically. No repository selection or JSON is
   required. Choose the public CA certificate if the server uses a private CA.
3. **Browse PR review history** shows originals, replies, body versions, and
   linked guidance. **View downloaded review knowledge** shows the available
   signed prompts, Skills, criteria, and memories, grouped by readable source
   name. **Reference sources…** optionally limits which sources to consult.
4. Run an Analyze command. Relevant active guidance and bounded historical
   sources are selected locally and pinned for that review.
5. Inspect source URLs, IDs, hashes, and the model's applicability explanation.
   Inclusion in context and use in a reasoned assessment are separate evidence.

An unregistered local repository can use authorized sources as references.
Only a source matching the local Git remote supplies that repository's policy;
other repositories do not impose mandatory policy on the current worktree.
**Import connection JSON…** remains available for older server configurations.

A repaired change should be assessed against the requirement without repeating
an old defect. Unrelated guidance should be excluded with an applicability
explanation. See [worked examples](docs/how-to.md).

**Connection status** shows synchronization, identity, and expiry information.
Online manifests have a maximum five-minute freshness window. **Use signed
offline knowledge** requires a valid cached snapshot and signed offline lease;
it cannot bypass known revocation, denied access, or expiry. Explicit local
fallback is labeled and does not establish central-policy compliance.
**Use standalone review** retains the connection while selecting local context.
See [central connections and caches](docs/central-review.md).

## Automatic reviews and hooks

Open **Automatic Reviews** and opt into individual triggers for the selected
repository/worktree. All four default to **off** on a new install. Existing
preferences are preserved; workspace settings cannot enable automatic execution.

| Trigger | Captured change | Operation |
| --- | --- | --- |
| Save | Saved working-tree changes against HEAD | Manual saves by default; Auto Save and external changes need separate opt-in |
| Stage | Changes to the actual Git index | Preserves partial staging and worktree index paths |
| Commit | Git's actual commit index | Enqueues a review after an existing hook succeeds |
| Push | Outgoing old/new commit pairs | Captures pre-push input and enqueues a review |

The independent service uses the selected Codex executable, account, model,
and reasoning setting. Manual API support does not imply API support for
automatic registration. Set `serviceNodePath` to Node.js 22+ when needed.

Save/Stage events use a three-second debounce. Save starts default to a
ten-minute minimum interval; automatic admission allows six review starts per
hour in the same profile/worktree. Manual starts count toward this admission
budget. These limits count review starts, not tokens or provider billing.
Duplicate requests can reuse results, new input cancels obsolete work, and
waiting manual reviews take priority over new automatic starts.

Background findings update history and eligible diagnostics without opening
a summary or moving focus. Commit/Push normally return after durable enqueue;
that does not mean the model finished. **Recover Background Review** inspects
interrupted or saved work. **Local Review Activity** summarizes saved attempts
and findings without model calls or uploads.

Managed hooks preserve existing hook arguments, output, and exit status. The
original hook runs first and its failure still stops Git. Advisory findings
or service/model failures do not block an otherwise successful hook. Registration
uses repository-local `core.hooksPath` and explicit worktree routes; removing
the final route restores the previous setting. Conflicting external changes
are preserved and reported.

Use **Pause automatic reviews in this worktree** or **Pause all automatic
reviews** to suspend admission. Disable Commit/Push in the same menu to remove
their managed routes. A running service can differ from the installed extension:
let reviews finish and use the documented stop/replacement procedure. Do not
delete hooks or kill unrelated Node/Codex processes to update it. See
[automatic-review behavior](docs/automatic-reviews.md) and
[service recovery](docs/windows-native.md).

### Separate legacy hook

**Install Pre-commit Hook** and `preCommitHook: enable` control the older
provider-based hook. It can block commits on P3 and has separate prompt,
suppression, and credential behavior. It is not required for manual review or
the advisory service. Enabling both paths can run two reviews. **Uninstall
Pre-commit Hook** removes that legacy hook, not Automatic Reviews routes.

Legacy severity/richness settings, inline skip comments, and file-based Skills
are not permission or policy overrides for the current fixed-source path.

## Commands

All names below have the **Commit Defender:** prefix in the Command Palette.

| Command | Purpose |
| --- | --- |
| Analyze Staged Files / Current File / Directory… / Repository | Start a manual review |
| Cancel Analysis / Clear Findings | Stop a review or clear displayed findings |
| Show Summary Panel / Show History Entry / Re-analyze | Inspect saved reports or start another review |
| Select Account Provider and Model | Choose the local execution identity |
| Sign in with Codex / Claude Code / Antigravity | Open the corresponding CLI login flow |
| Manage Model API Credential | Store, reconnect, replace, or migrate a key |
| Local Memory and Skills | Author and activate local guidance |
| Central Review Connection | Connect, synchronize, browse history, or select offline/standalone mode |
| Automatic Reviews / Recover Background Review | Manage opt-in triggers and interrupted work |
| Refresh Local History / Local Review Activity | Reload reports or inspect recorded activity |
| Discuss Review | Ask about a report and captured source |
| Generate Commit Message | Draft a message in the SCM input box |
| Install / Uninstall Pre-commit Hook | Manage the separate legacy hook |

## Settings

Open **Settings → Extensions → Commit Defender**. Each setting below uses the
`commitDefender.` prefix. Store execution choices in **User Settings**.

| Setting | Default | Effect |
| --- | --- | --- |
| `aiProvider` / `model` | `aoai` / empty | Provider and model or Azure deployment |
| `endpoint` / `apiVersion` | empty / `2024-08-01-preview` | Destination and Azure API version |
| `reviewReasoningEffort` | `xhigh` | Must match model capability; empty for Anthropic/Gemini |
| `codexPath` | `codex` | Executable selection |
| `reviewMode` / `localProfile` | `standalone` / `default` | Context mode and storage profile |
| `modelCredentialRef` | unset | Non-secret reference created by credential management |
| `excludePatterns` | `[]` | Additional gitignore-style source exclusions |
| `fileTimeoutSeconds` / `directoryTimeoutSeconds` | `120` / `360` | Run limits, maximum 600; zero uses the default; preparation has a separate equal limit |
| `maxTokens` | `4096` | API output limit; not a hard Codex output-token cap |
| `stagedFilesWarnThreshold` / `repoAnalysisWarnThreshold` | `20` / `80` | Large-review confirmation thresholds; zero disables the prompt |
| `colorPalette` | `theme-adaptive` | Finding colors, including accessible palettes |
| `runOnSave` / `runOnStage` / `runOnCommit` / `runOnPush` | `false` | Default automatic trigger opt-ins |
| `reviewAutoSaves` / `reviewExternalChanges` | `false` | Additional Save event classes |
| `automaticSaveIntervalSeconds` / `automaticReviewsPerHour` | `600` / `6` | Save interval and admission budget |
| `automaticReviewsPaused` | `false` | Global pause; manual review remains available |
| `serviceNodePath` | `node` | Node.js 22+ for the private service |
| `hookReviewWaitSeconds` | `0` | Optional Commit/Push wait, up to 600 seconds; does not change Git exit policy |
| `preCommitHook` | `disable` | Separate legacy blocking hook |

The legacy provider reviewer also exposes `severityLevel` (`moderate`),
`richnessLevel` (`moderate`), and `locale` (`en`, with `ko` available). These
prompt controls do not replace shared-core review criteria or grant source/tool
access.

## Privacy and local data

The selected model provider receives captured source and applicable context.
Account reviews use the existing CLI account; API reviews use the
destination-bound credential.

GCR communication is read-only: server-known repository/PR/history IDs, cursors,
and revisions retrieve history and signed guidance. **Local code, diffs,
questions, reports, conversations, and personal Memory are not uploaded to
GCR.** There is no central model proxy or downloaded executable-check runner.

Local records are encrypted and scoped by user, profile, repository/worktree,
and central audience where applicable. Credential-store failure, invalid
signatures, and access denial remain failures. Keys are not placed in new
settings or hook JSON. Explicit exports and model requests have different data
boundaries from encrypted local history.


## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Provider or executor unavailable | User Settings, CLI path/version, login, model/effort availability, and platform coverage |
| API credential unavailable | Manage Model API Credential, profile/destination, unlocked OS store, and explicit legacy migration |
| Nothing runs after Save or Stage | Trigger opt-in, pause, Save origin, debounce, and admission budget |
| Service cannot start | Node.js 22+, `serviceNodePath`, selected Codex executor, and running service version |
| No findings but partial/failed status | Inspect the problem and coverage; zero findings is not success |
| Review times out | Source size and run limit; increasing token limits does not fix every timeout |
| GCR unavailable | Connection status and selected signed-cache/local-fallback policy |
| GCR returns 401/403 or revoked access | Restore reader authority and synchronize; do not reuse denied context |
| Old findings no longer navigate | Source changed or the recorded version is unavailable; inspect history or review again |
| Commands missing after installation | Installed version versus running Host; reload when active work finishes |
| Two reviews or unexpected Git blocking | Separate legacy hook or other existing hooks alongside Automatic Reviews |

Use the **Commit Defender** Output channel and report problem codes to diagnose
failures. Include versions and the failing operation in an issue; omit
credentials and private source.

For more detail: [Installation](docs/installation.md),
[standalone review](docs/standalone-review.md), [how-to examples](docs/how-to.md),
[feature specification](docs/features.md), and [architecture](docs/architecture.md).
