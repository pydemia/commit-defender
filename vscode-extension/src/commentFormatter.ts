/**
 * commentFormatter — single source of truth for comment display data.
 *
 * normalizeReport() is the ONLY place where lint findings and AI comments
 * are merged into CommentBlock[]. All viewers (CommentController, diagnostics,
 * summary webview, CodeLens) consume CommentBlock[] from this module.
 *
 * No default priority is applied — every block's priority comes from the
 * linter severity or from the AI response.
 */

import {
  CommentCategory, CommentPriority, FileComment, LintFinding,
  PRIORITY_META, AnalysisReport, CommentBlock,
} from './types.js';

const VALID_PRIORITIES = new Set<string>(['P0', 'P1', 'P2', 'P3']);

/** Returns true if the FileComment has a recognised priority. */
export function hasValidPriority(fc: FileComment): boolean {
  return VALID_PRIORITIES.has(fc.priority);
}

/** Map a linter severity string to a CommentPriority. */
export function severityToPriority(severity: string): CommentPriority {
  if (severity === 'error')   { return 'P3'; }
  if (severity === 'warning') { return 'P2'; }
  return 'P1';
}

/**
 * Infer a CommentCategory from a lint rule code.
 *
 * Mapping rationale:
 *  security    — flake8-bandit S-rules (known vulnerability patterns)
 *  optimization — perflint PERF, McCabe C90, flynt FLY
 *  maintenance  — style/naming/formatting: pycodestyle E/W, pep8-naming N,
 *                 pydocstyle D, isort I, quotes Q, pyupgrade UP, annotations ANN,
 *                 simplify SIM, dead-code ERA, print T20, unused-args ARG,
 *                 type-check imports TC, tidy-imports TID, pathlib PTH,
 *                 commas COM, logging-format G, boolean-traps FBT, ISC, ICN,
 *                 pytest-style PT, future-annotations FA, ruff-specific RUF
 *  correctness  — everything else (pyflakes F, bugbear B, runtime logic, …)
 */
export function lintRuleCategory(rule: string | undefined): CommentCategory {
  if (!rule) { return 'correctness'; }
  const r = rule.toUpperCase();

  if (/^S\d/.test(r))                                       { return 'security'; }
  if (/^(PERF|C90|FLY)/.test(r))                            { return 'optimization'; }
  if (/^(E|W|N|D|I|Q|UP|ANN|SIM|ERA|T|ARG|TC|TID|PTH|COM|G|FBT|ISC|ICN|PT|FA|RUF)/.test(r)) {
    return 'maintenance';
  }
  return 'correctness';
}

/** Capitalise a category slug, e.g. "correctness" → "Correctness". */
export function formatCategory(category: string | undefined): string {
  if (!category) { return 'Review'; }
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Numeric rank for sorting: P3=3 (worst) … P0=0 (best). */
export const PRIORITY_RANK: Record<CommentPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * Return the PRIORITY_META entry for a CommentBlock.
 * Throws if priority is unrecognised — the AI or linter must always set it.
 */
export function metaForBlock(b: CommentBlock) {
  const meta = PRIORITY_META[b.priority];
  if (!meta) { throw new Error(`CommentBlock has invalid priority: "${b.priority}" (${b.file}:${b.line})`); }
  return meta;
}

/** Return the PRIORITY_META entry for a FileComment's priority. */
export function metaForComment(fc: FileComment) {
  const meta = PRIORITY_META[fc.priority];
  if (!meta) { throw new Error(`FileComment has no valid priority: "${fc.priority}" (file: ${fc.file} line: ${fc.line})`); }
  return meta;
}

/** Return the PRIORITY_META entry for a LintFinding's severity. */
export function metaForLintFinding(f: LintFinding) {
  return PRIORITY_META[severityToPriority(f.severity)];
}

/** Return PRIORITY_META for a raw CommentPriority string. */
export function metaForPriority(p: CommentPriority) {
  return PRIORITY_META[p];
}

/**
 * Convert a full AnalysisReport into a flat, sorted CommentBlock[].
 * This is the ONLY place where lint findings and AI comments are merged.
 * Order: P3 first → P0 last. Within the same priority: lint before ai, then by line.
 *
 * When the AI completed successfully but returned no line-level file_comments
 * (e.g. the file was too large for the model to map findings to specific lines),
 * a synthetic block is created at line 1 of each staged file from the overall
 * summary text. This ensures the COMMENTS tab, Analysis Findings section, and
 * Problems panel always have something visible after a real review.
 */
export function normalizeReport(report: AnalysisReport): CommentBlock[] {
  const blocks: CommentBlock[] = [];

  for (const f of report.lint_findings) {
    blocks.push({
      file:     f.file,
      line:     f.line,
      col:      f.col,
      priority: severityToPriority(f.severity),
      category: lintRuleCategory(f.rule),
      comment:  f.message,
      source:   'lint',
      rule:     f.rule,
    });
  }

  for (const fc of report.review.file_comments) {
    if (!hasValidPriority(fc)) { continue; }
    blocks.push({
      file:     fc.file,
      line:     fc.line,
      priority: fc.priority,
      category: fc.category || '',
      comment:  fc.comment,
      source:   'ai',
    });
  }

  // Synthesise a file-level block when the AI gave no line-specific comments.
  // Covers: large files where the model only produces an overall verdict,
  // or any other case where file_comments is empty but a real review ran.
  if (
    blocks.length === 0 &&
    !report.review.is_error &&
    report.review.summary &&
    report.staged_files.length > 0
  ) {
    const priority: CommentPriority = report.review.blocking ? 'P3' : 'P1';
    for (const file of report.staged_files) {
      blocks.push({
        file,
        line:     1,
        priority,
        category: '',
        comment:  report.review.summary,
        source:   'ai',
      });
    }
  }

  return blocks.sort((a, b) => {
    const ra = PRIORITY_RANK[a.priority] ?? 1;
    const rb = PRIORITY_RANK[b.priority] ?? 1;
    if (rb !== ra) { return rb - ra; }
    if (a.source !== b.source) { return a.source === 'lint' ? -1 : 1; }
    return a.line - b.line;
  });
}

/**
 * Return the single worst CommentPriority across all blocks.
 * Worst = highest rank (P3 beats P2 beats P1 beats P0).
 */
export function worstPriority(blocks: CommentBlock[]): CommentPriority | undefined {
  let worst: CommentPriority | undefined;
  let worstRank = -1;
  for (const b of blocks) {
    const r = PRIORITY_RANK[b.priority] ?? -1;
    if (r > worstRank) { worstRank = r; worst = b.priority; }
  }
  return worst;
}
