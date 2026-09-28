# Commit Defender Settings

Run **Commit Defender: Open Settings** or select the gear in the Commit
Defender Side Panel. The editor tab and page heading both read **Commit
Defender Settings**. The GCR Setup Guide is a separate native Walkthrough.

## Choose an account or API destination

In **Account & Model**, inspect the saved provider, model/deployment, effort
and credential method. A saved selection is not a claim that login or model
access is currently valid. Opening this page makes no model request.

- **Choose account & model…** checks the existing Codex, Claude Code or
  Antigravity login, retrieves that account's models, and offers supported
  effort. Each provider row also has **Choose model…** and **Sign in…**.
  Missing authentication or a failed catalog query preserves the selection.
- **Configure API destination & key…** chooses a provider, endpoint,
  deployment/model and supported effort. Keys are entered in a masked native
  input and stored with the existing OS-backed credential manager. Use its
  **Existing keys and plaintext migration…** option to manage older keys.
  Setup verifies local storage; provider/model access is checked during review.

Cancelling a setup step leaves the current selection unchanged. CLI login
remains owned by the CLI. No API key or OAuth credential is rendered in this
webview. The output-token limit below the provider list applies to API adapters.

## Edit preferences

| Section | Controls |
| --- | --- |
| Commit Message | Multiline generated-message format and its model/Git variables |
| Review & Display | Source exclusions, run limits, warning thresholds, finding colors and legacy feedback controls |
| Automatic Reviews | Global Save/Stage/Commit/Push defaults, additional Save events, pause, interval and review-start budget |
| Memory & GCR | Default review mode and access to local knowledge, connection/synchronization and history |
| Profiles & Executables | Local profile and Codex, Claude Code, Antigravity and background-service executable paths |

Make edits, then select **Save User Settings**. Only changed fields in the
current section are saved. Drafts in other sections remain until saved or
discarded. **Discard edits** discards all drafts and reloads current settings.
Opening a section or refreshing it does not enable automation or install hooks.
Refresh preserves drafts and asks you to save or discard them first.

### Commit message format

The **Commit Message** section contains a multiline format field. Commit
Defender asks the selected model for structured message parts, then renders the
saved format locally. The default keeps the existing layout:

```text
[$type] $title

$body
```

Model-output variables are `$type`, `$scope`, `$title`, and `$body`. Local Git
variables are `$branch`, `$branchId`, `$issueId`, `$prId`, `$commitId`, and
`$date`. `${title}` is equivalent to `$title`; `$$` writes a literal dollar
sign. `$issueId` uses an issue number found in the current branch, including a
leading numeric branch segment. `$prId` requires a `pr` or `pull` marker such
as `pr/1099-fix`. If a format references Git metadata that cannot be resolved,
generation stops before contacting the selected model and links back to this
setting. The format must include `$title`.

The page writes User Settings. For a window/resource setting, an existing
workspace override is shown beneath its field. Edit that override with **VS
Code Settings**; the page does not overwrite it. Fixed-source account, model,
profile and executable choices are taken from User Settings by the runtime.
Changing profile selects separate knowledge/history and destination-bound API
credentials. Reconfigure the API destination after a profile change.

Existing automatic-review overrides are scoped to profile and worktree.
**Manage this worktree…** opens their existing manager; global defaults alone
do not remove those overrides. The older blocking pre-commit hook is under
**Separate legacy blocking pre-commit hook**. It is distinct from advisory
background Commit/Push triggers.

If another window or setup flow changes settings while you edit, the page
retains your drafts and asks you to discard/reload before saving. Validation
and concurrent-change checks happen in the Extension Host before settings
writes. Failed multi-field saves roll back their own writes without replacing
a concurrent user change. Check the native settings editor if VS Code reports
a storage/write failure.

## Side Panel and Command Palette

The Side Panel groups review actions, current findings, settings/connections
and saved history. **Account / Provider** and **Model** lead directly to
Account & Model. The gear opens the named editor; the refresh icon loads local
history. Setup Guide is available from the view menu and settings header.

In the Command Palette, search **Commit Defender: Settings** to jump to
Account and Model, Commit Message, Review and Display, Automatic Reviews,
Memory and GCR, Profiles and Executables, or the native VS Code Settings editor. Existing
**Use Account**, **Use API Credential**, sign-in, knowledge and connection
commands retain their command IDs and remain available independently.
