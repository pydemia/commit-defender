# Installation and configuration

This guide describes the extension and shared-core review path in this checkout. Check the extension version in `package.json` and in VS Code's Extensions view. A locally built VSIX, an already running Extension Host and a Marketplace release can be different versions.

## Requirements

| Requirement | Scope |
| --- | --- |
| VS Code 1.90 or newer | Extension activation; use a trusted Git workspace |
| Git | Staged and working-tree snapshots, captured base and repository identity |
| Node.js 22 or newer | Building from source and the independent automatic-review service; ordinary extension workers use VS Code's runtime |
| OS credential store | macOS Keychain or Linux Secret Service; no plaintext fallback. This build has no Windows adapter |
| Selected provider and usable model | Codex account review is verified on macOS with CLI 0.153.4/0.154.0; API adapters are OpenAI, Azure OpenAI, Anthropic and Gemini |
| GCR reader access | Only if you want central history/knowledge; standalone review requires no GCR server |

Claude Code, Gemini CLI and Antigravity retain separate account/commit-message integration. They are not supported fixed-source review executors in this build. Actual end-to-end model verification recorded for G03/G04 used Codex on macOS; API provider support also has adapter regression coverage, not an assertion that every model has been live-tested.

## Install a supplied VSIX

In VS Code, open Extensions, choose **Install from VSIX…**, and select the artifact supplied for your release. If the `code` command is available:

```bash
code --install-extension /absolute/path/commit-defender.vsix
code --list-extensions --show-versions
```

Confirm `pydemia.commit-defender` and its version. An installation does not guarantee that an existing window has loaded the new code. Reload the window when you are ready; do not interrupt a review just to update. Existing accounts, credentials, provider/model choices and automatic-review preferences should be retained. Marketplace publishing is a separate operation and is not performed by installing a VSIX.

## Build a VSIX from source

From the repository root, checkout the release or branch you intend to use, then:

```bash
cd vscode-extension
npm ci
npm run build
npx @vscode/vsce package --no-dependencies --out commit-defender-local.vsix
code --install-extension ./commit-defender-local.vsix
```

`npm ci` uses the committed lockfile and local `vendor/gcr` artifacts. `npm run build` typechecks and bundles the extension, review workers, hook adapters and private service. `vsce` also runs the prepublish build. `--no-dependencies` is intentional: runtime dependencies are already bundled, and vendor tarballs/source tests are not shipped. Keep `third-party` notices in the package. Nothing in this procedure publishes to Marketplace or replaces the user's global GCR/Codex CLI.

## Configure an account and model

Run **Commit Defender: Select Account Provider and Model**. Store choices in **User Settings**. Workspace settings can narrow source exclusions but cannot authorize another account, model, executable or local profile.

For Codex, use **Commit Defender: Sign in with Codex** with a supported CLI already installed on the machine. The CLI owns account login. `commitDefender.codexPath` can select the intended executable without replacing it. Choose a model available to that account and set `commitDefender.reviewReasoningEffort` to a supported value. Choosing an account does not overwrite an existing reasoning setting.

For API models, choose the provider, model and destination first, then run **Commit Defender: Manage Model API Credential**. Azure uses the deployment name as the model and needs its endpoint/API version. The key is stored in OS-backed encrypted storage; do not paste a key into a repository file. If an old installation has `commitDefender.apiKey`, use the command's explicit migration flow. The new review path does not silently read that legacy value.

Example User Settings for a Codex review (replace the model placeholder using your account catalog):

```json
{
  "commitDefender.aiProvider": "codex",
  "commitDefender.model": "<model available to your account>",
  "commitDefender.reviewReasoningEffort": "high",
  "commitDefender.reviewMode": "standalone",
  "commitDefender.localProfile": "default"
}
```

`high` is an example, not support guaranteed for every model. OpenAI/Azure receive nonempty reasoning settings; leave the setting empty for Anthropic/Gemini adapters. The centrally registered GCR analysis account does not configure this local choice.

## Verify the first review

1. Open the Git worktree, save a small change and stage it.
2. Run **Commit Defender: Analyze Staged Files**. For saved but unstaged content, choose Analyze Current File instead.
3. Wait for a terminal result. Check Summary and source/context provenance, not only the findings count.
4. If the result is failed, cancelled, partial or needs context, inspect the problem before retrying. A source read is not a test run.
5. Add a [GCR connection](central-review.md) only after the local provider works. Connection Status does not itself invoke a model.

## Settings worth checking

| Setting or command | Effect |
| --- | --- |
| `aiProvider`, `model`, `reviewReasoningEffort`, `codexPath` | Local execution identity; read from User Settings |
| `reviewMode`, `localProfile` | Standalone/central selection and local storage identity |
| `fileTimeoutSeconds`, `directoryTimeoutSeconds` | Model-run limit; zero uses 120/360 seconds, maximum 600. Preparation has its own limit |
| `excludePatterns` | Additional source exclusions; cannot authorize sensitive source otherwise excluded |
| Central Review Connection | Explicit repository connection, synchronization, history and cache policy |
| Automatic Reviews | Save/Stage/Commit/Push opt-in; defaults off for new installations |
| `serviceNodePath` | Node.js 22+ for the private background service, separate from the Codex executable |
| `preCommitHook` | Separate legacy hook installation policy; not required for a manual review or GCR pulling |

Review [automatic behavior and legacy hook coexistence](automatic-reviews.md) before enabling triggers. Updating the extension must not be used as an implicit choice to turn them on.

## Legacy Python package

The repository-root Python package is separate from the VSIX and GCR shared-core review. Python 3.12 or newer is required. For an isolated source installation:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install .
CD_REPO_PATH=/absolute/path/to/target/repo CD_SKIP_AI=1 .venv/bin/commit-defender
```

Run these commands from the Commit Defender checkout. Replace `/absolute/path/to/target/repo` with the Git repository whose staged changes you want to inspect without an AI call. It can still run the local rule/linter path and return a nonzero status. Python settings use `CD_*` environment variables, defined in `commit_defender/settings.py`; they do not configure VS Code's current shared-core reviews.

`commit-defender install <repo>` and `uninstall <repo>` manage that legacy Python hook. Installing it changes Git behavior and is an explicit separate choice. It does not provide GCR reader connections, shared-core encrypted history or the VSIX's local review workflow. Do not layer it onto existing hooks solely to follow this installation guide.
