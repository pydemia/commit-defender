/**
 * Pre-commit hook entry point. Bundled by esbuild to a single
 * `out/hook-cli.js` file that doesn't depend on VS Code APIs.
 *
 * Reads <repo>/.commit-defender/hook.json (written by the extension on hook
 * install), runs the AI review against the staged diff, prints a colour
 * report to stderr, and exits 0 (allowed by legacy hook policy) or 1 (block).
 *
 * Cannot import anything from vscode.* — esbuild is configured to mark vscode
 * as external; calling into it here would explode at runtime.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ResolvedConfig } from '../config.js';
import { getStagedSelection } from '../gitHelper.js';
import { resolveExitCode } from '../exitResolver.js';
import { OUTCOME_META, reviewCoverage, reviewStatus } from '../reviewOutcome.js';
import { AnalysisReport, FileComment } from '../types.js';
import { Reviewer } from '../ai/reviewer.js';

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

async function main(): Promise<void> {
  const repoRoot = process.argv[2] || process.cwd();
  const cfg = readConfig(repoRoot);
  if (!cfg) {
    eprintln('commit-defender: hook config not found — skipping review.');
    eprintln('  Re-install the hook from VS Code: command "Commit Defender: Install Pre-commit Hook".');
    process.exit(0);
  }

  const selection = getStagedSelection(repoRoot, cfg.excludePatterns);
  if (selection.files.length === 0) {
    for (const entry of selection.excluded) eprintln(`Excluded ${JSON.stringify(entry.path)}: ${entry.reason}`);
    eprintln('commit-defender: review NOT RUN — no permitted staged source. Commit not blocked.');
    process.exit(0);
  }
  eprintln(`\ncommit-defender — reviewing ${selection.files.length} staged file(s)…`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), 120_000);
  let report: AnalysisReport;
  try { report = (await new Reviewer(cfg).reviewDiff(repoRoot, selection.files, controller.signal)).report; }
  finally { clearTimeout(timer); }
  for (const entry of report.source_exclusions ?? []) eprintln(`Excluded ${JSON.stringify(entry.path)}: ${entry.reason}`);
  const exitCode = resolveExitCode(report, 'legacy-hook');
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
    codexPath:       raw.codexPath ?? 'codex',
    claudeCodePath:  raw.claudeCodePath ?? 'claude',
    geminiCliPath:   raw.geminiCliPath ?? 'gemini',
    antigravityPath: raw.antigravityPath ?? 'agy',
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

// ── Plain-text report (no ANSI deps; emoji is enough) ───────────────────────

const PRIORITY_LABEL: Record<string, string> = {
  P0: '🟩 P0 Praise', P1: '🟦 P1 Info', P2: '🟧 P2 Warning', P3: '🟥 P3 Critical',
};

function printReport(report: AnalysisReport, blocked: boolean): void {
  const r = report.review;
  eprintln('');
  eprintln('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  eprintln(`  Review: ${OUTCOME_META[reviewStatus(r)].label.toUpperCase()}`);
  eprintln(`  Legacy hook: ${blocked ? 'BLOCKED' : 'ALLOWED'}`);
  eprintln(`  ${reviewCoverage(report)}`);
  if (r.grade && reviewStatus(r) === 'completed') { eprintln(`  Grade: ${r.grade}`); }
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
    eprintln('\nThis commit was blocked by a P3 Critical finding or the model blocking flag.');
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
  eprintln(`commit-defender: review FAILED; commit not blocked — ${(e as Error).message}`);
  process.exit(0); // do not block commits on internal errors
});
