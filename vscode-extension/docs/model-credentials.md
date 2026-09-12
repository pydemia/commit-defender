# Model API credentials (development branch)

Run **Commit Defender: Manage Model API Credential** after selecting an API provider, endpoint and model in User Settings. A new key is entered in a native password box. Settings and new hook configurations store a reference. Runtime code does not read `commitDefender.apiKey` as a fallback.

This applies to Azure OpenAI, OpenAI, Anthropic and Gemini API adapters used by commit-message generation and the legacy hook. Standalone fixed-source review still uses the supported Codex account executor. Codex, Claude Code, Gemini CLI and Antigravity retain their own login stores; this command does not copy or migrate those accounts.

## Migrate an existing value

Choose the specific User Settings, Workspace Settings or hook copy in the command. Confirm its provider and destination. The extension writes an encrypted record, closes it, reopens its OS wrapping key and verifies the credential before replacing the hook field or removing the selected settings value. Other plaintext copies are preserved. Repeat the migration for each copy you intend to remove.

The reference is tied to a local profile, provider, endpoint, model/deployment and Azure API version. Changing these fields cannot silently reuse the previous credential. API endpoints require HTTPS, with HTTP allowed only for localhost development. API requests do not follow redirects. A different key already stored for the same destination stops migration; this command does not silently replace it.

To reconnect an existing profile and destination, choose **Use a key already stored for this selection**. To replace a key, choose **Store a model API key…**, enter the new value and confirm **Replace Key**. Replacement checks the stored revision shown to that operation; a concurrent replacement prevents a stale overwrite. Existing references for that profile and destination use the verified replacement.

Automatic settings mirroring will not overwrite a legacy hook that still contains a key. Until it is migrated, an API-based hook reports that review did not run and preserves the existing configuration. A credential error does not become a passing review. The legacy hook's existing policy permits the commit when review cannot run.

## Storage and headless use

Model secrets use AES-256-GCM records under `model-credentials/v1` in the application-data directory. Their wrapping keys use the OS service `com.commitdefender.model-credentials.v1`. This directory and service are separate from personal Memory/Skills, central connections, GitHub and publisher credentials. On macOS the application-data root is `~/Library/Application Support/CommitDefender`.

The shared OS adapter supports macOS Keychain and Linux Secret Service. A headless hook needs the same OS user, local profile, encrypted data and available credential store; copying `hook.json` to a CI runner does not copy its key. Windows has no supported adapter in this build. There is no plaintext fallback when a key is missing or the store is locked.

## Interrupted migration

If storage or reference verification fails, the selected legacy value is retained. A retry can find the verified record by its public destination identity, without another plaintext journal. A different stored value or a changed source configuration stops the operation for review.

Hook replacement uses a cooperating-process lock, the original file bytes, a new 0600 file and an atomic rename. Locks left by an exited writer can be recovered. Settings migration rechecks the source value and selected destination before removal and uses VS Code's configuration update API; it does not provide an atomic transaction across multiple VS Code processes or settings files.

Migration removes the selected current value. It does not rewrite Git history, editor backups or copies outside that selection.
