# commit-defender — Architecture Blueprint

A pure TypeScript VS Code extension that runs an AI code review against staged
changes and ships its own git pre-commit hook. No external runtime
dependencies beyond Node 18+ for the standalone hook.

---

## Two execution paths, one review

```
┌─────────────────────────────────────────────────────────────────┐
│ Path A: in-editor (live)                                        │
└─────────────────────────────────────────────────────────────────┘

  git add foo.ts                                  user typing
       │                                                │
       ▼                                                ▼
  index watcher ─► commitDefender.analyze         analyzeCurrentFile
                                                  analyzeDirectory
                                                  analyzeRepository
       │
       ▼
  Reviewer (src/ai/reviewer.ts)
       │
       ├─► getStagedDiff() / getFileContents()  (src/diff.ts)
       ├─► loadSkills()                          (src/skills.ts)
       ├─► buildSystemPrompt()                   (src/ai/prompt.ts)
       ├─► callProvider()                        (src/ai/providers.ts)
       ├─► parseReviewJson() + enforceP3()       (src/ai/json.ts)
       └─► applyMarkers()                        (src/skipMarkers.ts)
       │
       ▼
  AnalysisReport
       │
       ├─► Diagnostics  (Problems panel)
       ├─► CommentController  (inline threads)
       ├─► CodeLens
       ├─► Summary webview
       └─► History tree

┌─────────────────────────────────────────────────────────────────┐
│ Path B: pre-commit hook (terminal / any git client)             │
└─────────────────────────────────────────────────────────────────┘

  git commit
       │
       ▼
  .git/hooks/pre-commit  (10-line shell wrapper)
       │
       ▼
  node out/hook-cli.js <repo>
       │
       ▼
  Same Reviewer pipeline ──► reads .commit-defender/hook.json
                                       │
                                       ▼
                              Same AnalysisReport
                                       │
                                       ├─► ANSI report → stderr
                                       └─► exit 0 / 1 → git
```

The two paths share the entire `src/ai/` and `src/diff.ts` / `src/skipMarkers.ts`
/ `src/skills.ts` modules. The hook bundle (`out/hook-cli.js`, ~47 KB) is a
single esbuild artefact that pulls those modules in without touching anything
under `vscode.*`.

---

## Source layout

```
vscode-extension/
├── src/
│   ├── extension.ts            ← VS Code activation, commands, webview
│   ├── config.ts               ← ResolvedConfig + getConfig() from settings
│   ├── types.ts                ← AnalysisReport / FileComment / CommentBlock
│   │
│   ├── diff.ts                 ← git diff + file content extraction
│   ├── excludeFilter.ts        ← gitignore-style filter (uses `ignore` lib)
│   ├── skills.ts               ← .commit-defender/*/SKILL.md loader
│   ├── skipMarkers.ts          ← # CD:skip / # TODO / # type: ignore filter
│   ├── exitResolver.ts         ← P3 → blocking
│   │
│   ├── ai/
│   │   ├── prompt.ts           ← system prompt + severity/richness/locale
│   │   ├── providers.ts        ← aoai / openai / anthropic / gemini fetch adapters
│   │   ├── json.ts             ← robust JSON parser + P3 text enforcement
│   │   └── reviewer.ts         ← orchestrator: reviewDiff / reviewFilesSeparately
│   │
│   ├── hook/
│   │   ├── install.ts          ← write/remove pre-commit hook + hook.json
│   │   └── cli.ts              ← bundled Node entry invoked by the hook
│   │
│   ├── gitHelper.ts            ← getRepoRoot, getStagedFiles, collectFiles
│   ├── findingsStore.ts        ← in-memory cache of last analysis
│   ├── commentFormatter.ts     ← AnalysisReport → CommentBlock[]
│   ├── diagnostics.ts          ← CommentBlock[] → vscode.Diagnostic[]
│   ├── comments.ts             ← CommentBlock[] → CommentThread[]
│   ├── codeLens.ts             ← CodeLens provider
│   ├── panelProvider.ts        ← bottom-panel tree view
│   ├── historyProvider.ts      ← activity-bar history tree
│   ├── statusBar.ts            ← status-bar item
│   ├── outputChannel.ts        ← shared OutputChannel
│   └── palette.ts              ← color palettes (priority + category)
│
├── package.json                ← settings schema, commands, build scripts
├── tsconfig.json
└── out/                        ← build artefacts
    ├── extension.js            ← esbuild bundle (~137 KB)
    └── hook-cli.js             ← esbuild bundle (~47 KB)
```

---

## Build pipeline

| Script | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` — type safety, no JS output |
| `npm run bundle-extension` | `esbuild src/extension.ts → out/extension.js` (vscode external) |
| `npm run bundle-hook` | `esbuild src/hook/cli.ts → out/hook-cli.js` (vscode external) |
| `npm run build` | typecheck + both bundles |
| `npm run package` | `vsce package` — produces the .vsix |

Both bundles inline the `ignore` runtime dep so the published extension
doesn't need `node_modules` shipped in the .vsix.

---

## Pre-commit hook design

```sh
#!/usr/bin/env sh
# commit-defender hook v2
set -e
REPO_ROOT="$(git rev-parse --show-toplevel)"
if ! command -v node >/dev/null 2>&1; then
    echo "commit-defender: node not found in PATH — skipping pre-commit review." >&2
    exit 0
fi
exec node '<extension-install-path>/out/hook-cli.js' "$REPO_ROOT"
```

The hook is a thin shell wrapper. All review logic lives in
`out/hook-cli.js`, which is the same Reviewer pipeline as the extension uses.

### Config materialisation

VS Code settings are mirrored into `<repo>/.commit-defender/hook.json`
whenever any `commitDefender.*` setting changes. The hook reads that file at
commit time — it cannot query VS Code, since the editor may not be running.

```jsonc
// <repo>/.commit-defender/hook.json   (auto-generated, gitignored)
{
  "aiProvider": "anthropic",
  "model": "claude-sonnet-4-6",
  "endpoint": "",
  "apiVersion": "2024-08-01-preview",
  "apiKey": "sk-ant-...",
  "maxTokens": 4096,
  "severityLevel": "moderate",
  "richnessLevel": "moderate",
  "locale": "en",
  "excludePatterns": []
}
```

The file is added to `.gitignore` automatically on hook install (alongside a
`# commit-defender (contains API key)` comment).

### Replacing existing hooks

If `.git/hooks/pre-commit` already contains content from another tool (husky,
lefthook, …) the install command prompts before replacing it and writes a
backup at `pre-commit.backup-<timestamp>` so the prior content is recoverable.

---

## AnalysisReport JSON shape

The shared contract between Reviewer, summary webview, and hook stderr
renderer:

```ts
interface AnalysisReport {
  schema_version: 1;
  staged_files: string[];
  duration_ms: number;
  exit_code: 0 | 1;
  lint_findings: never[];        // reserved; always empty in v2
  review: {
    summary: string;             // markdown
    blocking: boolean;
    is_error: boolean;
    file_comments: FileComment[];
    grade: 'exceptional' | 'proficient' | 'adequate' | 'insufficient' | 'critical' | '';
    per_file_summaries?: PerFileSummary[];
  };
}

interface FileComment {
  file: string;                  // repo-relative path
  line: number;                  // 1-based; 0 = file-level
  comment: string;               // markdown
  category: 'correctness' | 'security' | 'maintenance' | 'optimization' | 'review-history' | 'setting' | '';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
}
```

`lint_findings` is reserved as an always-empty field for forward
compatibility — the AI is the sole reviewer in v2.

---

## Provider abstraction

Each provider in `src/ai/providers.ts` exports the same `callProvider(req) →
{raw, error?}` signature. The `raw` string is expected to be a JSON object
matching the schema in the system prompt.

| Provider | Endpoint | Auth | Body shape |
|---|---|---|---|
| `aoai` | `${endpoint}/openai/deployments/{model}/chat/completions?api-version=…` | `api-key:` header | OpenAI chat with `response_format: json_object` (retried without if rejected) |
| `openai` | `${endpoint or default}/chat/completions` | `Authorization: Bearer …` | Same as aoai |
| `anthropic` | `${endpoint or default}/messages` | `x-api-key:` + `anthropic-version: 2023-06-01` | `system` + `messages[]` |
| `gemini` | `${endpoint or default}/models/{model}:generateContent?key=…` | API key in URL | `systemInstruction` + `contents[]` + `responseMimeType: application/json` |

All four share the same retry-on-`response_format-unsupported` logic for the
OpenAI-compatible endpoints, and a unified error-context line that names the
provider, model, and endpoint in failure messages.

---

## Priority enforcement layers

A comment can become P3 (Critical, blocking) at three layers:

1. **AI assignment** — the model returns `priority: "P3"` directly.
2. **Text-pattern enforcement** — `enforceP3()` upgrades to P3 when the comment
   text matches inherently-critical patterns (syntax error, import error,
   security vulnerability, data-loss risk, etc.). Localised for English and
   Korean.
3. **Severity floor** — `SEVERITY_MIN_RANK` filters out anything below the
   user's configured floor. `severityLevel: lean` keeps only P3.

The `moderate` severity additionally caps P1 (Info) at 2 per file so optional
nits don't drown out P2/P3 signal.

---

## Settings reference

See [vscode-extension/README.md](vscode-extension/README.md#extension-settings).

---

## Verification checklist

1. `npm run build` — both bundles produced cleanly.
2. Open the .vsix in VS Code, set provider + key, stage a file with a known
   bug, observe inline finding + Problems entry.
3. Set `commitDefender.preCommitHook: enable`, close VS Code, run
   `git commit` from a terminal — review prints to stderr, P3 blocks the
   commit.
4. Edit `commitDefender.severityLevel`, run `git commit` again — new severity
   takes effect (settings flowed through `hook.json`).
5. Drop `<repo>/.commit-defender/security/SKILL.md` with a project-specific
   rule, observe it influencing reviews.
