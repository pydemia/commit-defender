# Changelog

## 2.14.12

- Draft an editable PR title and description from committed branch changes
  against a selected target branch. The draft excludes uncommitted edits and
  warns when the diff exceeds the model input limit.
- Review committed branch changes through the shared fixed-source reviewer,
  using the selected account, model and local or central review knowledge.
- Review the impact of a virtual merge into a target branch without changing
  either branch, the index or the working tree. Report merge conflicts before
  calling the model.

## 2.14.11

- When a model cites a source read ID that the review did not issue, retry once
  with the actual read IDs and their ranges. Keep the same source snapshot,
  account, model, deadline and review budget; still reject invalid responses.
- Include both model calls in review timing when this correction is needed.

## 2.14.10

- Show the recorded review failure cause in Summary, the failure notification,
  and Output. For invalid model output, name the rejected response condition;
  Korean reviews explain unknown source read IDs in Korean.
- Remove the account sign-in action from failed review notifications. Model
  response validation failures are not evidence of an expired login.

## 2.14.9

- Show the exact reviewed source range above each finding in Commit Defender
  Summary when the recorded source hash still matches. Long ranges are bounded
  without substituting current working-tree content.
- Separate the problem and impact from a concrete suggested change. Standalone
  reviews require suggestions for actionable findings, and central GCR results
  retain their structured recommendation when available.
- Keep earlier saved reports compatible when the new end-line and recommendation
  fields are absent.

## 2.14.8

- Retry with local review criteria when central knowledge becomes unavailable
  during a review and the connection permits standalone fallback. Preserve the
  selected account, model and source snapshot; show the fallback reason.
- Retry saved failed, cancelled and incomplete reviews on the next run while
  continuing to reuse completed reviews with identical inputs.
- Restore the Commit Defender Summary order: overall result, per-file review,
  source-linked comments and selected files. Move execution metadata, evidence
  and excluded paths into a collapsible detail section.
- Open Output when the running status indicator is clicked. Use **Cancel
  Analysis** for explicit cancellation and record that command in Output.

## 2.14.7

- Keep large optional callers and examples out of Codex's initial review
  prompt. Selected source and base stay prioritized; the fixed-source tools
  still allow the model to inspect related files when needed.
- Set the default single-file model limit to 180 seconds. Explicit user
  settings remain unchanged.

## 2.14.6

- Open **Commit Defender Settings → Memory & GCR** from the GCR connection
  command instead of opening VS Code Welcome.
- Apply the effective review language to shared-core model output. Korean and
  English reviews use separate reuse keys, so an earlier English result is not
  reused for a Korean request.
- Raise the default single-file model limit from 120 to 300 seconds. Show
  timeouts as failed reviews with a settings action, clear the findings spinner
  when a result arrives, and distinguish cancelled reviews in the summary.
- Clarify that **Sign in / switch…** is an account action, not a live login
  status indicator. Preserve existing user-selected time limits.

## 2.14.5

- Deliver the 2.14.0–2.14.4 settings, review prefetch, and commit-message
  changes together. Completed reviews with identical source, context, and
  executor settings continue to reuse their encrypted saved results.

## 2.14.4

- Add a multiline commit-message format field to Commit Defender Settings.
  Formats support `$type`, `$scope`, `$title`, `$body`, `$branch`, `$branchId`,
  `$issueId`, `$prId`, `$commitId`, and `$date`; `${name}` is equivalent and
  `$$` emits a literal dollar sign.
- Render the saved format locally from structured model output and Git metadata.
  Unavailable repository variables stop before a model request. Existing
  settings keep the prior `[$type] $title` plus body layout by default.
- Remove the previous 300-character body cap and request coverage of every
  material staged change while keeping the title suitable for Git history.

## 2.14.3

- Preload up to 64 KiB / 24 authorized source reads into Codex reviews to reduce
  model/tool round trips for selected source, captured base and required context.
  Larger reviews continue through the existing fixed-source tools. Source
  receipts, full-coverage validation, model/effort, cancellation, revocation and
  review budgets are unchanged.
- Record preparation, execution, source-preload and model durations in Commit
  Defender Output. Reused reports do not start a new model review.

## 2.14.2

- Honor `commitDefender.locale` when generating commit messages. Korean titles
  and bodies use Korean instructions and examples while type labels, JSON keys,
  code identifiers and file paths retain their original spelling.

## 2.14.1

- Distinguish Commit Defender's Source Control header action with a commit
  icon and document its separate entry point from GitHub Copilot's button.
- Use the selected SCM repository, check staging and source exclusions before
  resolving credentials, and record generation progress in Commit Defender Output.
- Preserve drafts edited during generation. Stop presenting every generation
  failure as an account sign-in problem.

## 2.14.0

- Add the named **Commit Defender Settings** editor with Account & Model,
  Review & Display, Automatic Reviews, Memory & GCR, and Profiles & Executables.
  Reuse verified account/catalog and OS-backed API credential setup flows.
- Save changed User Settings explicitly, retain drafts across sections, validate
  values in the Extension Host and reject concurrent settings overwrites.
- Organize Side Panel review actions, findings, settings/connections and history.
  Provider/Model rows open model settings; add section-specific Command Palette
  entry points and keep native VS Code Settings available for workspace overrides.

## 2.13.6

- Replace manual account model IDs with **Use Account**: verify the existing
  Codex, Claude Code or Antigravity login and connection, fetch account models,
  then select supported effort. Antigravity uses exact returned model variants.
- Add **Use API Credential** for provider, endpoint, deployment/model, supported
  effort and encrypted key storage. Unknown capabilities keep the server default;
  Azure deployment names are not interpreted as model identities.
- Save a complete selection after all steps finish. Cancellation, failed queries
  and concurrent settings edits preserve the previous selection and other keys.

## 2.13.5

- Count source provenance before admitting central review knowledge into the
  existing 64 KiB context budget. Large optional references no longer abort
  directory review preparation; required repository policy remains mandatory.
- Distinguish required-instruction budget failures from context validation
  failures before model execution, without exposing private diagnostics.

## 2.12.8

- Render the bilingual GCR guide in VS Code's native Walkthrough viewer, with
  static diagrams and buttons for account/model selection and GCR connection.
  Follow the display language, default to English, and offer language switching.
  Guide rendering no longer depends on the Markdown preview Service Worker.
- Add Open Settings to the Command Palette, guide, and sidebar to open the
  native settings UI filtered to Commit Defender. Opening it preserves values.
- Identify Commit Defender and the operation in previously unattributed error
  notifications for central connections, review preparation, history activity,
  local knowledge, model credentials, and review conversations/recovery.

## 2.12.7

- Open the bundled English/Korean GCR setup guide from the Command Palette, central
  connection menu, or sidebar help icon. Use VS Code Markdown preview with a
  text fallback when preview is unavailable; reading needs no GCR login.
  Follow the VS Code display language, default to English, and offer links
  between languages.
- Cover reader keys, local account/model selection, HTTPS, synchronization,
  source evidence, and connection troubleshooting. Existing review runtime
  dependencies and account settings are unchanged.

## 2.12.6

- Restore a complete Details-page guide with setup examples, review workflows,
  commands, settings, automatic hooks, and troubleshooting.
- Provide Windows, macOS, and Linux VSIX targets for ARM64 and x64. Target
  packaging and native execution evidence are documented separately.
- Add Linux Codex account isolation without credential copies or inherited
  global instructions. Verify one authenticated Luna/high review in a WSL2
  Linux ARM64 Extension Host, including source evidence and encrypted history.
- Pin executor alpha.50 and private CLI/service alpha.39; reuse contract alpha.48,
  core alpha.49, and native helper 1.0.3. Pin local vsce 4.0.0 for packaging.

## 2.12.5

- Deliver native Windows ARM64 reviews with user-scoped credential storage,
  NTFS permission checks, captured source isolation and owned process cleanup.
- Connect opt-in automatic reviews to the native local service and preserve
  existing Git hooks, cancellation and failed or partial report states.
- Include the completed Windows support and recovery guide, platform limits
  and corrected Marketplace documentation links.
- Reuse the runtime files verified in 2.12.4: client-contract alpha.48,
  client-core/client-executors alpha.49, native helper 1.0.3 and private
  CLI/service alpha.38. Existing accounts and automatic-review settings remain
  unchanged.

## 2.11.3

- Keep the overall history applicability assessment visible alongside per-file summaries. The model worker and common packages are unchanged from 2.11.2.

## 2.11.2

- Ask source-linked reviews to explain whether historical guidance applies, is already satisfied, is excluded, or was not used, with the original source ID and URL in the summary. Zero-finding reviews can now explain why an old criticism does not apply.

## 2.11.1

- Pass the review response schema in Codex prompt instructions to avoid the CLI output-schema path that stalled account reviews during verification. Existing response and source-evidence validation still reject malformed or incomplete reviews.

## 2.11.0

- Pull GCR PR review originals, replies, body versions, thread observations and source-linked guidance with the existing reader connection.
- Select applicable guidance locally and pin source revisions for each review; record original URLs and version hashes in results.
- Preserve local model and reasoning selection with or without GCR. Connect the existing OpenAI, Azure OpenAI, Anthropic and Gemini API adapters to captured-source reviews.
- Keep authorized offline caches, sensitive-file exclusion, cancellation and failed-review outcomes.

This version also delivers the local Memory/Skills, advisory review and connection work previously installed as local 2.4–2.10 builds. Review account settings must be in User Settings. Existing plaintext API keys are preserved until explicitly migrated with Manage Model API Credential. New installations do not automatically enable stage reviews.
