/**
 * Pre-commit hook entry point. Bundled by esbuild to a single
 * `out/hook-cli.js` file that doesn't depend on VS Code APIs.
 *
 * Reads <repo>/.commit-defender/hook.json (written by the extension on hook
 * install), runs the AI review against the staged diff, prints a colour
 * report to stderr, and exits 0 (pass) or 1 (block).
 *
 * Cannot import anything from vscode.* — esbuild is configured to mark vscode
 * as external; calling into it here would explode at runtime.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ResolvedConfig } from '../config.js';
import { getStagedDiff } from '../diff.js';
import { applyExcludes } from '../excludeFilter.js';
import { resolveExitCode } from '../exitResolver.js';
import { applyMarkers } from '../skipMarkers.js';
import { loadSkills } from '../skills.js';
import { AnalysisReport, FileComment } from '../types.js';
import { ParsedReview, enforceP3, parseReviewJson } from '../ai/json.js';
import { SEVERITY_MIN_RANK, buildSystemPrompt, buildUserMessage } from '../ai/prompt.js';
import { callProvider } from '../ai/providers.js';

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

async function main(): Promise<void> {
  const repoRoot = process.argv[2] || process.cwd();
  const cfg = readConfig(repoRoot);
  if (!cfg) {
    eprintln('commit-defender: hook config not found — skipping review.');
    eprintln('  Re-install the hook from VS Code: command "Commit Defender: Install Pre-commit Hook".');
    process.exit(0);
  }

  const stagedAll = listStagedFiles(repoRoot);
  if (stagedAll.length === 0) {
    process.exit(0);
  }
  const staged = applyExcludes(stagedAll.filter(p => !isBinary(p)), cfg.excludePatterns);
  if (staged.length === 0) {
    process.exit(0);
  }

  const diff = await getStagedDiff(repoRoot, staged);
  if (!diff.trim()) { process.exit(0); }

  eprintln(`\n🛡  commit-defender — reviewing ${staged.length} staged file(s)…`);

  const skillsText = loadSkills(repoRoot);
  const systemPrompt = buildSystemPrompt({
    mode: 'diff',
    severity: cfg.severityLevel,
    richness: cfg.richnessLevel,
    locale: cfg.locale,
    skillsText,
  });
  const userMessage = buildUserMessage('diff', diff);

  const resp = await callProvider({
    provider: cfg.aiProvider,
    apiKey: cfg.apiKey,
    endpoint: cfg.endpoint,
    apiVersion: cfg.apiVersion,
    model: cfg.model,
    maxTokens: cfg.maxTokens,
    systemPrompt,
    userMessage,
    timeoutMs: 120_000,
  });

  if (resp.error) {
    eprintln(`\n⚠ AI review unavailable — commit not blocked.\n  ${indent(resp.error, '  ')}`);
    process.exit(0);
  }

  let parsed: ParsedReview;
  try {
    parsed = parseReviewJson(resp.raw);
  } catch (e) {
    eprintln(`\n⚠ Could not parse AI response — commit not blocked.\n  ${(e as Error).message}`);
    process.exit(0);
  }

  const minRank = SEVERITY_MIN_RANK[cfg.severityLevel] ?? 1;
  let comments: FileComment[] = parsed.file_comments
    .map(fc => ({ ...fc, priority: enforceP3(fc.priority, fc.comment) } as FileComment))
    .filter(fc => (PRIORITY_RANK[fc.priority] ?? 1) >= minRank);
  comments = applyMarkers(comments, staged, repoRoot);

  const report: AnalysisReport = {
    schema_version: 1,
    staged_files: staged,
    duration_ms: 0,
    exit_code: 0,
    lint_findings: [],
    review: {
      summary: parsed.summary,
      blocking: parsed.blocking,
      is_error: false,
      file_comments: comments,
      grade: parsed.grade as AnalysisReport['review']['grade'],
    },
  };
  const exitCode = resolveExitCode(report);
  printReport(report, exitCode === 1);
  process.exit(exitCode);
}

function readConfig(repoRoot: string): ResolvedConfig | null {
  const file = path.join(repoRoot, '.commit-defender', 'hook.json');
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  let raw: any;
  try { raw = JSON.parse(text); } catch { return null; }
  return {
    aiProvider:      raw.aiProvider ?? 'aoai',
    model:           raw.model ?? '',
    endpoint:        raw.endpoint ?? '',
    apiVersion:      raw.apiVersion ?? '2024-08-01-preview',
    apiKey:          raw.apiKey ?? '',
    maxTokens:       Number.isFinite(+raw.maxTokens) ? +raw.maxTokens : 4096,
    severityLevel:   raw.severityLevel ?? 'moderate',
    richnessLevel:   raw.richnessLevel ?? 'moderate',
    locale:          raw.locale ?? 'en',
    excludePatterns: Array.isArray(raw.excludePatterns) ? raw.excludePatterns : [],
    // UX fields aren't read by the hook but the type demands them.
    colorPalette: 'theme-adaptive',
    preCommitHook: 'enable',
    fileTimeoutSeconds: 0,
    directoryTimeoutSeconds: 0,
    stagedFilesWarnThreshold: 0,
    repoAnalysisWarnThreshold: 0,
    runOnStage: false,
  };
}

function listStagedFiles(repoRoot: string): string[] {
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
      encoding: 'utf8',
    });
    return out.split('\n').filter(Boolean);
  } catch (e) {
    eprintln(`commit-defender: git diff failed — ${(e as Error).message}`);
    return [];
  }
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.tiff', '.tif', '.heic', '.heif', '.avif',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv',
  '.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  '.jar', '.war', '.ear', '.vsix', '.whl', '.egg',
  '.pyc', '.pyo', '.pyd', '.class',
  '.so', '.dll', '.dylib', '.exe', '.bin', '.o', '.a', '.wasm',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.db', '.sqlite', '.sqlite3',
  '.parquet', '.arrow', '.avro', '.pkl', '.pickle', '.npy', '.npz',
  '.lock',
]);

function isBinary(p: string): boolean {
  const ext = path.extname(p).toLowerCase();
  return ext.length > 0 && BINARY_EXTENSIONS.has(ext);
}

// ── Plain-text report (no ANSI deps; emoji is enough) ───────────────────────

const PRIORITY_LABEL: Record<string, string> = {
  P0: '🟩 P0 Praise', P1: '🟦 P1 Info', P2: '🟧 P2 Warning', P3: '🟥 P3 Critical',
};

function printReport(report: AnalysisReport, blocked: boolean): void {
  const r = report.review;
  eprintln('');
  eprintln('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  eprintln(blocked ? '  🛡  commit-defender — BLOCKED' : '  🛡  commit-defender — PASS');
  if (r.grade) { eprintln(`  Grade: ${r.grade}`); }
  eprintln('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (r.summary) {
    eprintln('\nSummary:');
    eprintln(indent(r.summary, '  '));
  }

  if (r.file_comments.length > 0) {
    eprintln('\nFindings:');
    const byFile = new Map<string, FileComment[]>();
    for (const c of r.file_comments) {
      const list = byFile.get(c.file) ?? [];
      list.push(c);
      byFile.set(c.file, list);
    }
    for (const [file, list] of byFile) {
      eprintln(`\n  ${file}`);
      list.sort((a, b) => (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1) || a.line - b.line);
      for (const c of list) {
        const label = PRIORITY_LABEL[c.priority] ?? c.priority;
        const where = c.line > 0 ? `:${c.line}` : ' (file-level)';
        const cat = c.category ? ` [${c.category}]` : '';
        eprintln(`    ${label}${cat} ${file}${where}`);
        eprintln(indent(c.comment, '      '));
      }
    }
  }

  if (blocked) {
    eprintln('\nThis commit was blocked because at least one P3 Critical finding was raised.');
    eprintln('Fix the issues above and try again, or use `git commit --no-verify` to skip the check.');
  }
  eprintln('');
}

function eprintln(s: string): void {
  process.stderr.write(s + '\n');
}

function indent(text: string, prefix: string): string {
  return text.split('\n').map(l => prefix + l).join('\n');
}

main().catch(e => {
  eprintln(`commit-defender: unexpected error — ${(e as Error).stack ?? e}`);
  process.exit(0); // do not block commits on internal errors
});
