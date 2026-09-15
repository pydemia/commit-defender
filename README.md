# Commit Defender

Commit Defender reviews local Git changes in VS Code using the model provider you select. It captures source before review, preserves failed and incomplete outcomes, and shows findings with their source and context versions. Manual reviews and the opt-in background review service are advisory.

You can use local Memory and Skills without a server, or pull PR review history, Skills, prompts and published guidance from Git Code Reviewer (GCR). Connecting to GCR does not select a central model or change your account, model or reasoning setting. Local code, diffs, questions, results, conversations and personal Memory are not uploaded to GCR. Approved source and review context are sent to your selected model provider.

## Start here

1. [Install the VSIX and configure a provider](vscode-extension/docs/installation.md). Use the artifact built from the release or branch you intend to run; Marketplace publication is a separate delivery step.
2. Open a trusted Git workspace, select **Commit Defender: Select Account Provider and Model**, and configure credentials in User Settings.
3. Save and stage a small change, then run **Commit Defender: Analyze Staged Files**. New installations do not start reviews automatically when you stage files.
4. Inspect the status, current-source evidence and Summary. An empty findings list is meaningful only with a completed review and understood coverage.
5. To reuse central material, follow [Connect to GCR](vscode-extension/docs/central-review.md). A repository connection JSON and a `commit-defender` reader key are separate from your model credential.

## Guides and specifications

| Document | Use it for |
| --- | --- |
| [Installation and configuration](vscode-extension/docs/installation.md) | VSIX/source installation, requirements, accounts, settings and upgrade checks |
| [How-to and examples](vscode-extension/docs/how-to.md) | First review, historical guidance, cancellation, cache and common problems |
| [Feature specification](vscode-extension/docs/features.md) | Commands, inputs, outputs, provider/OS boundaries and unsupported actions |
| [Architecture](vscode-extension/docs/architecture.md) | Extension, workers, local service, shared packages, storage and trust boundaries |
| [Central connection](vscode-extension/docs/central-review.md) | Reader setup, raw PR history, signed knowledge and revocation |
| [Standalone review](vscode-extension/docs/standalone-review.md) | Fixed source, local Memory/Skills, deadlines and result evidence |
| [Automatic reviews](vscode-extension/docs/automatic-reviews.md) | Explicit Save/Stage/Commit/Push opt-in and legacy hook coexistence |
| [Model credentials](vscode-extension/docs/model-credentials.md) | OS-backed API keys and migration from legacy plaintext settings |
| [Review conversations](vscode-extension/docs/review-conversations.md) | Local follow-up conversations on saved reviews |

The [GCR installation and connection guide](https://github.com/pydemia/git-code-reviewer/blob/codex/review-memory-pull-g01/docs/product/getting-started.md) describes the server side in Korean. [Extension README](vscode-extension/README.md) is also included in the VSIX.

## Scope and compatibility

The current fixed-source review path supports Codex on macOS with the verified CLI versions listed in the setup guide, and the existing OpenAI, Azure OpenAI, Anthropic and Gemini API adapters. A CLI appearing in a sign-in or commit-message menu does not imply fixed-source review support. Unsupported selections fail without silently switching providers.

The repository also contains the separate Python `commit-defender` package and the legacy Node pre-commit hook. They are not the shared-core local review service. In particular, the legacy hook may block a commit on P3; current manual/background findings do not. Do not install another hook to enable central history pulling. See the [legacy compatibility section](vscode-extension/docs/installation.md#legacy-python-package).

Results retain the model's evidence and limitations. Reading source or validating a line anchor does not run tests. Downloaded Skills are instructions, not executable checks. The P11 runner, central execution proxy and local-to-central result submission are outside the delivered review workflow.

## Development

```bash
cd vscode-extension
npm ci
npm run build
npm run typecheck:test
```

The `vendor` directory contains pinned GCR tarballs and provenance. The build bundles them into the extension and prepares its private background service; it does not replace a global CLI. Use the targeted `test:*` scripts listed in `package.json` for the code you change. Build/package/install instructions and artifact checks are in [Installation](vscode-extension/docs/installation.md).

## License

MIT — see [LICENSE](LICENSE).
