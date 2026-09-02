# Account-authenticated CLI providers

## 1. Objective

Add account-authenticated local AI providers to the Commit Defender VS Code extension:

- `codex`: run the official Codex CLI with the user's saved ChatGPT/Codex login.
- `claudecode`: run the official Claude Code CLI with the user's saved Claude subscription login.
- `geminicli`: run the official Gemini CLI with the user's saved Google-account login.
- `antigravity`: run the Antigravity `agy` CLI with the user's saved account login.

The feature must work in both execution paths:

1. In-editor review and commit-message generation while VS Code is running.
2. The standalone git pre-commit hook while VS Code is closed.

API-key providers (`aoai`, `openai`, `anthropic`, and `gemini`) remain unchanged.

## 2. Constraints and decisions

### 2.1 Authentication boundary

Commit Defender does not read, parse, copy, refresh, or persist OAuth tokens.
It delegates authentication to the installed first-party CLI.

- Codex uses `codex exec`, which reuses saved CLI authentication.
- Claude Code uses `claude -p`, which reuses its subscription login.
- Gemini CLI uses `gemini -p`, which reuses its cached Google login.
- Antigravity uses `agy -p`, which reuses its saved login. Login itself starts
  by launching `agy` without arguments.
- `.commit-defender/hook.json` stores executable paths and provider settings,
  never Codex or Claude OAuth credentials.

This avoids coupling the extension to private token file formats, keychain
implementations, refresh-token rotation, and provider-specific OAuth headers.

### 2.2 Runtime dependency

The account-backed providers are optional local runtime integrations:

- `codex` requires a working Codex CLI. The extension can start `codex login`.
- `claudecode` requires a working Claude Code CLI. The extension can start
  `claude auth login --claudeai`.
- `geminicli` requires a working Gemini CLI. The extension selects Gemini
  account authentication and starts its browser flow.
- `antigravity` requires a working Antigravity CLI. The extension starts `agy`
  without arguments so its first-use browser flow can run.

Gemini CLI and Antigravity are not treated as a rename: current installations
can expose both `gemini` and `agy`, so both providers remain available.

The executable settings default to `codex`, `claude`, `gemini`, and `agy`, so normal `PATH`
resolution works. Absolute paths are supported for GUI git clients and
pre-commit environments whose `PATH` differs from the VS Code environment.

### 2.3 Browser sign-in and redirect ownership

Commit Defender exposes **Sign in with Codex**, **Sign in with Claude Code**,
**Sign in with Gemini**, and **Sign in with Antigravity** commands. It also offers the matching action
when an account-backed review or commit-message request fails.

Immediately after opening the login terminal, the extension asks whether the
current workspace should switch to that account provider. The user can keep
the current provider, use the CLI's default model (stored as an empty model
setting), or choose an alias/exact model ID. A separate **Select Account
Provider and Model** command provides the same model picker without logging in.
Changing `commitDefender.aiProvider` directly to an account-backed provider in
VS Code Settings also asks whether to use the CLI default before that provider
is used, preventing a model ID from the previous API provider from carrying
over unnoticed.

Login runs as the shell process of a VS Code integrated terminal so the CLI has
a real TTY and can open its browser normally:

```text
codex login
claude auth login --claudeai
GOOGLE_GENAI_USE_GCA=true gemini
agy
```

The CLI, rather than Commit Defender, opens the browser, hosts/receives its
OAuth redirect, refreshes credentials, and writes its credential store. If
automatic browser opening is unavailable, its terminal remains visible and
provides the login URL. Commit Defender never persists the URL or credentials.

This browser interaction is extension-only. A git pre-commit hook is
non-interactive and must never launch a browser; when its login is absent or
expired, it prints remediation guidance and follows the existing fail-open
policy.

### 2.4 Structured output

The CLI providers receive the same JSON contract used by Commit Defender's
existing parser.

- Codex receives a temporary schema file through `--output-schema`.
- Claude Code receives the schema JSON through `--json-schema` and returns
  the structured value in its JSON envelope's `structured_output` field.
- Gemini CLI receives the JSON contract in the prompt and returns its final
  text in the JSON envelope's `response` field.
- Antigravity receives a temporary prompt and schema file, and returns its
  structured value in a supported JSON envelope field.

The provider adapter normalizes both outputs to the raw JSON string expected
by `parseReviewJson`. Commit-message generation uses a separate schema.

### 2.5 Safety and isolation

Commit Defender provides the complete diff or file content on stdin. The
model does not need write tools.

Codex invocation:

```text
codex exec --ephemeral --sandbox read-only --ignore-user-config
  --ignore-rules --color never --output-schema <temporary-file> [--model ...] -
```

Claude Code invocation:

```text
claude -p --output-format json --json-schema <schema>
  --tools "" --permission-mode dontAsk --no-session-persistence
  --disable-slash-commands --no-chrome [--model ...]
```

Gemini CLI invocation:

```text
gemini --output-format json --approval-mode plan --skip-trust
  [--model ...] -p <system-prompt>
```

Antigravity invocation:

```text
agy --output-format json --mode plan --disable-slash-commands --sandbox
  --add-dir <temporary-directory> --json-schema <temporary-schema>
  [--model ...] -p <instruction-to-read-temporary-prompt>
```

Claude Code's `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` environment
variables are removed for this provider so they cannot silently override the
selected subscription login. `CLAUDE_CODE_OAUTH_TOKEN` remains available for
headless user-managed authentication.

Gemini CLI's `GEMINI_API_KEY`, `GOOGLE_API_KEY`, and
`GOOGLE_GENAI_USE_VERTEXAI` variables are removed for `geminicli`, ensuring the
provider uses its cached Google-account login.

Subprocesses are started without a shell, receive arguments as an array, and
are terminated on timeout or cancellation. Stdout and stderr are bounded to
prevent an uncontrolled child process from exhausting extension memory.

### 2.6 Failure policy

Provider failures remain non-blocking internal errors, consistent with the
current hook behavior. Errors identify:

- a missing executable,
- a missing/expired login,
- a non-zero CLI exit,
- malformed or missing structured output,
- timeout or cancellation.

P3 findings returned by a successful review continue to block the commit.

## 3. Configuration contract

Add the provider values:

```jsonc
"commitDefender.aiProvider": "codex"      // or "claudecode" / "geminicli" / "antigravity"
```

Add executable settings:

```jsonc
"commitDefender.codexPath": "codex",
"commitDefender.claudeCodePath": "claude",
"commitDefender.geminiCliPath": "gemini",
"commitDefender.antigravityPath": "agy"
```

`commitDefender.model` is optional for these providers. When empty, the CLI
chooses its current default model. `endpoint`, `apiVersion`, `apiKey`, and
`maxTokens` remain API-provider settings; the CLI provider controls its own
account limits and output budget.

## 4. Code changes

### Phase 1 — shared provider contract

1. Extend `AIProvider` with `codex`, `claudecode`, `geminicli`, and `antigravity`.
2. Add CLI executable paths to `ResolvedConfig` and hook configuration.
3. Add `workingDirectory`, `executablePath`, and `responseSchema` to
   `ProviderRequest`.
4. Define reusable review and commit-message JSON Schemas.

### Phase 2 — subprocess adapters

1. Implement a bounded, cancellable subprocess runner.
2. Implement the Codex adapter and temporary schema lifecycle.
3. Implement the Claude Code adapter and JSON-envelope normalization.
4. Implement the Gemini CLI adapter and JSON-envelope normalization.
5. Implement the Antigravity adapter and structured-output normalization.
6. Map executable/auth/process errors to actionable provider errors.

### Phase 3 — integration and UX

1. Pass the repository root and correct response schema from `Reviewer`.
2. Pass the same fields from the standalone hook.
3. Add provider and path settings to `package.json`.
4. Add command-palette browser sign-in commands for all account providers.
5. Add provider-specific Sign in actions to analysis and commit-message errors.
6. Add a post-login provider/model popup and a standalone provider/model picker.
7. Keep the standalone hook explicitly non-interactive.
8. Update README, architecture notes, and requirements.

### Phase 4 — verification and release

1. Add fake-CLI unit tests for arguments, stdin, schema normalization,
   environment sanitization, timeout, and missing executables; validate login
   commands and provider metadata in the extension manifest.
2. Run typecheck, unit tests, extension bundle, and hook bundle.
3. Package the VSIX and inspect its contents.
4. Bump the minor version because this adds user-visible providers.
5. Publish to the configured VS Code Marketplace publisher and verify the
   published version.

## 5. Acceptance criteria

- Selecting `codex` works without `commitDefender.apiKey` after `codex login`.
- Selecting `claudecode` works without `commitDefender.apiKey` after Claude
  Code subscription login.
- Selecting `geminicli` works without `commitDefender.apiKey` after Google
  account login in Gemini CLI.
- Selecting `antigravity` works without `commitDefender.apiKey` after signing
  in through the browser flow opened by `agy`.
- All CLI providers return the existing review JSON shape and support commit
  message generation.
- Cancellation and configured timeouts terminate the child process.
- Claude account mode cannot be accidentally replaced by
  `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`.
- No OAuth credential is written to workspace files or hook configuration.
- Existing four API providers continue to build and behave as before.
- The standalone hook can use an explicitly configured absolute CLI path.
- **Sign in with Codex** launches the CLI-owned browser/localhost redirect flow.
- **Sign in with Claude Code** launches subscription login without allowing API
  environment variables to override it.
- **Sign in with Gemini** opens a real terminal for the Google browser flow.
- **Sign in with Antigravity** opens a real terminal and launches `agy` without
  arguments for its browser sign-in flow.
- Codex automatically reuses the official OpenAI VS Code extension's bundled
  CLI when the default `codex` command is absent from PATH.
- Starting account sign-in offers to update the workspace provider and model
  together, so the previous API provider cannot remain active unnoticed.
- The pre-commit hook never opens a browser or starts an interactive login.
- The extension package builds, packages, and publishes successfully.

## 6. Known operational limitations

- A GUI git client may have a narrower `PATH` than an interactive shell;
  users should set an absolute CLI path in that case.
- The account provider consumes the selected account's subscription quota and
  is subject to its workspace policy and model availability.
- Codex remains an agent runtime even in a read-only sandbox and can inspect
  repository context. Claude Code is invoked with its built-in tools disabled.
- CLI flags evolve independently of Commit Defender. Failures include the
  detected command and remediation guidance, and future CLI compatibility can
  be handled without changing the review/report contract.
