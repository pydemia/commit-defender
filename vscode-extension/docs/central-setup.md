# Connect to GCR and run your first review

English · [한국어](central-setup.ko.md)

Commit Defender (CD) downloads review history, Skills, prompts, and published
guidance from Git Code Reviewer (GCR). Reviews run with the account and model
you select in CD. Connecting to GCR does not change your provider, model, or
reasoning settings.

This guide is bundled with the extension and can be read without Internet
access or a GCR connection. Open **Commit Defender: GCR Connection Guide** in
the Command Palette, use the help icon in the CD sidebar, or choose **Central
Review Connection → GCR connection guide**. The guide follows your VS Code
display language: Korean for `ko` locales, English otherwise. Use the link
above to switch languages manually.

## 1. Prepare a reader key and connection file in GCR

Sign in to your GCR website and open **Profile** (`/profile`). On a Korean GCR
interface, the corresponding controls are **프로필**, **클라이언트**, and
**저장소**.

1. Select **Commit Defender** as the client.
2. Select the repository you will review locally, then choose a key name and
   expiration period.
3. Issue an API key (**API key 발급**). CD needs a key for the `commit-defender`
   client with `knowledge:read` access to that repository.
4. Download the connection configuration for the selected repository
   (**선택한 저장소의 연결 설정 다운로드**) as a JSON file.

The JSON contains the server URL, repository identifiers, public signing keys,
and a CA certificate when required. Enter the reader key separately. It is
not your GCR login password, GitHub token, or model API key. A key issued for
`gcr-cli` cannot authorize CD.

CD requires **HTTPS** for a remote GCR connection, even if the GCR website
also allows HTTP. Use the administrator-provided JSON. For certificate errors,
check the server URL, certificate, and CA configuration. The connection JSON
can include an internal CA.

## 2. Open the repository in VS Code

Use VS Code 1.90 or later, open the Git repository or worktree, and trust the
workspace. Its Git remote must match the repository selected in GCR. A fork is
a separate repository.

Run the following commands from the Command Palette:

- macOS: `Cmd+Shift+P`
- Windows and Linux: `Ctrl+Shift+P`

## 3. Select your CD account and model

For a Codex account, run **Commit Defender: Select Account Provider and Model**
and select Codex and a model. If your model is not listed, choose **Enter a
model ID…** and enter an ID supported by your account and CLI. CD uses the
existing Codex login. If you need to sign in, run **Commit Defender: Sign in
with Codex**.

In VS Code **User Settings**, set `commitDefender.reviewReasoningEffort` to a
value supported by the selected model, such as `high`. Supported Codex CLI
versions are currently `0.153.4` and `0.154.0`; CD validates the model,
reasoning, and CLI capabilities when running a review. An analysis account
registered in GCR does not automatically configure CD.

For OpenAI, Azure OpenAI, Anthropic, or Gemini APIs, set
`commitDefender.aiProvider`, `commitDefender.model`, and any required endpoint
in User Settings. Then run **Commit Defender: Manage Model API Credential**
to store the key. Set review reasoning to an empty string for Anthropic and
Gemini APIs. See [provider setup](standalone-review.md) for supported behavior.

Account and model choices belong in User Settings. Opening this guide does
not change your account, model, or automatic-review settings.

## 4. Connect to GCR

1. Run **Commit Defender: Central Review Connection**.
2. Choose **Connect with API key…**.
3. Select the downloaded connection JSON.
4. Check the server, tenant, repository, and public signing-key information.
5. Enter the reader key in the password input.

The key is stored in the OS credential store; do not put it in settings files.
Initial publication and signature verification can take up to 60 seconds and
can be cancelled. The connection applies to the current local profile and
Git worktree.

## 5. Check the connection and downloaded material

Use these actions in **Central Review Connection**. Viewing and synchronizing
knowledge do not invoke a model.

| Action | What it shows or does |
| --- | --- |
| Connection status | Server, repository, user, key expiry, last sync, snapshot, and validity deadlines |
| Synchronize knowledge | Downloads, verifies, and activates central material |
| View downloaded review knowledge | Downloaded Skills, prompts, and review guidance |
| Browse PR review history | Original PR comments, replies, body versions, and source-linked guidance |

Online knowledge has a refresh window of at most five minutes and is
synchronized in the background. Each review pins the material versions it
uses. Original comments are past observations; applicability conditions,
counter-evidence, and claimed fixes are considered against the current code.

## 6. Run your first review

Save and stage a small change, then run **Commit Defender: Analyze Staged
Files**. For a saved but unstaged file, use **Analyze Current File**.

First check whether the result completed, partially completed, or failed.
Open **Show Summary Panel** to inspect findings, source references, snapshots,
and guidance versions.

| Effective mode | Meaning |
| --- | --- |
| Centralized · online | Uses central material verified online |
| Centralized · cached | Uses a valid signed cache |
| Standalone · fallback: reason | Uses local review without central material, according to the configured fallback policy |

Local code, diffs, questions, review results, conversations, and personal
Memory are not uploaded to GCR. The code and context needed for a review are
sent to **your selected model provider**. Selecting a local provider does not
necessarily mean inference runs on your computer.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Command is missing | Confirm the extension is installed and enabled. An existing window can still be running the previous version. Finish active work and reload the window yourself when needed. |
| Authentication failure or 401/403 | Confirm the key was issued for CD, has not expired or been revoked, and has read access to the selected repository. |
| Repository mismatch | Check the Git remote and repository in the connection JSON. Reconnect for the correct repository after changing remotes. |
| Certificate error | Check the HTTPS server URL and administrator-provided CA and certificate configuration. |
| No central material or server unavailable | Use Connection status and Synchronize knowledge. Distinguish missing published material from a temporary server outage. |
| Model execution failed | Check the CD account login, model, reasoning, provider usage limits, and supported CLI version. These are separate from the reader key. |

Use **Offline and fallback behavior…** to choose outage behavior. **Use
standalone review** retains the saved central connection and reviews with
local material. Revoked, expired, or invalidly signed central material cannot
be reused.

See [Central review](central-review.md) for connection and cache details, and
[Installation](installation.md) for setup and platform requirements.
