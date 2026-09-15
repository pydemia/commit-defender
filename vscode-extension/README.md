# Commit Defender

Commit Defender reviews captured local Git changes and displays advisory findings in VS Code. It can use local Memory and Skills, or pull review history and published guidance from a Git Code Reviewer (GCR) server. The selected local provider performs the review in both modes.

Use **Commit Defender: Select Account Provider and Model**, then an **Analyze** command. Reviews support Codex on macOS with verified CLI versions 0.153.4/0.154.0, Azure OpenAI, OpenAI, Anthropic and Gemini APIs. Set provider/model in User Settings. API credentials use destination-bound OS storage; **Manage Model API Credential** provides migration from legacy plaintext settings. See [provider capabilities and setup](docs/standalone-review.md).

To use central material, open **Central Review Connection** with a repository connection file and a `knowledge:read` key issued for `commit-defender`. **Browse PR review history** displays original comments, replies, body versions and source-linked guidance. Relevant active guidance and its historical sources are selected locally and pinned for each review. Results include the source URL, IDs and version hashes. [Central connection and cache behavior](docs/central-review.md) describes offline operation and access revocation.

Central propagation is one-way. GCR receives no local code, diffs, questions, review results, conversations or personal Memory. Source and review context are sent to the model provider you selected. Downloaded Skills and validation guidance are instructions; no downloaded executable code is run.

Reviews preserve incomplete, failed and cancelled outcomes. Manual findings are advisory and are not a passing test result. Stage review starts disabled for new installations; existing settings are preserved. Existing automatic review and hook behavior is documented in [Automatic reviews](docs/automatic-reviews.md). No CLI is globally replaced.

Upgrading from older Marketplace builds preserves saved settings and credentials. Review account choices must be explicitly stored in User Settings, and legacy plaintext API keys require explicit migration before the new review path can use them. Unsupported CLI review selections fail without silently changing providers.

Requirements: VS Code 1.90 or newer, a trusted Git workspace, a configured provider, and an available OS credential store. See [local storage](docs/standalone-review.md), [model credentials](docs/model-credentials.md), and [review conversations](docs/review-conversations.md).


## Setup and reference

- [Install, configure and upgrade](docs/installation.md): VSIX/source setup, provider credentials and first-review checks.
- [How-to and examples](docs/how-to.md): staged review, historical guidance, offline operation and troubleshooting.
- [Feature specification](docs/features.md): command contracts, provider/platform coverage and execution limits.
- [Architecture](docs/architecture.md): workers, shared packages, local service, storage and communication boundaries.

The Overall Summary explains the applicability of supplied history and remains visible with per-file summaries. Input provenance and a model's source-linked assessment are separate evidence. Online manifest freshness can stop a long review; a failed or cancelled result is never a clean review.
