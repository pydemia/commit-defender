# Changelog

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
