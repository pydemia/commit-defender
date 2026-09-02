/**
 * Top-level AI review orchestrator. Replaces the Python `AIReviewAgent`.
 *
 * Two entry points:
 *   reviewDiff()             — combined staged diff (pre-commit + staged scope)
 *   reviewFilesSeparately()  — one AI call per file (on-demand scopes)
 *
 * Both produce an AnalysisReport in the same JSON shape the rest of the
 * extension already consumes.
 */

import * as path from 'path';
import { ResolvedConfig } from '../config.js';
import { getFileContents, getStagedDiff, git } from '../diff.js';
import { resolveExitCode } from '../exitResolver.js';
import { applyMarkers } from '../skipMarkers.js';
import { loadSkills } from '../skills.js';
import { AnalysisReport, CommitMessageResult, FileComment, PerFileSummary, ReviewResult, RunResult } from '../types.js';
import { ParsedReview, enforceP3, parseReviewJson } from './json.js';
import { COMMIT_MESSAGE_SYSTEM_PROMPT, SEVERITY_MIN_RANK, ReviewMode, buildSystemPrompt, buildUserMessage } from './prompt.js';
import { ProviderRequest, callProvider } from './providers.js';
import { COMMIT_MESSAGE_OUTPUT_SCHEMA, REVIEW_OUTPUT_SCHEMA } from './schemas.js';

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const GRADE_RANK: Record<string, number> = {
  exceptional: 5, proficient: 4, adequate: 3, insufficient: 2, critical: 1,
};

export type ProgressCb = (current: number, total: number, file: string) => void;

export class Reviewer {
  constructor(private readonly cfg: ResolvedConfig) {}

  /** Pre-commit / staged scope: send the combined diff in a single call. */
  async reviewDiff(repoRoot: string, stagedFiles: string[], signal?: AbortSignal): Promise<RunResult> {
    const start = Date.now();
    try {
      const diff = await getStagedDiff(repoRoot, stagedFiles);
      const review = await this.singleCall({
        repoRoot, mode: 'diff', body: diff, signal,
      });
      review.file_comments = applyMarkers(review.file_comments, stagedFiles, repoRoot);
      const report = this.assembleReport(stagedFiles, review, Date.now() - start);
      return { report, stderr: '', timedOut: false, cancelled: false };
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return { report: this.emptyReport('Cancelled'), stderr: '', timedOut: false, cancelled: true };
      }
      return { report: this.errorReport((e as Error).message), stderr: '', timedOut: false, cancelled: false };
    }
  }

  /** On-demand scope: one AI call per file, then merge. */
  async reviewFilesSeparately(
    repoRoot: string,
    relPaths: string[],
    signal?: AbortSignal,
    onProgress?: ProgressCb,
  ): Promise<RunResult> {
    const start = Date.now();
    const allComments: FileComment[] = [];
    const perFile: PerFileSummary[] = [];
    const summaries: string[] = [];
    const grades: string[] = [];
    let blocking = false;

    const isMeaningful = (s: string): boolean =>
      Boolean(s) && s !== '(no summary)' && s !== 'AI review skipped';

    for (let i = 0; i < relPaths.length; i++) {
      if (signal?.aborted) {
        return { report: this.emptyReport('Cancelled'), stderr: '', timedOut: false, cancelled: true };
      }
      const rel = relPaths[i];
      onProgress?.(i + 1, relPaths.length, rel);

      const content = getFileContents(repoRoot, [rel]);
      let result: ReviewResult;
      try {
        result = await this.singleCall({ repoRoot, mode: 'file', body: content, signal });
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          return { report: this.emptyReport('Cancelled'), stderr: '', timedOut: false, cancelled: true };
        }
        result = this.errorResult((e as Error).message);
      }

      result.file_comments = applyMarkers(result.file_comments, [rel], repoRoot);

      if (result.is_error) {
        const errText = `⚠ ${result.summary}`;
        summaries.push(`**\`${rel}\`** — ${errText}`);
        perFile.push({ file: rel, summary: errText, priority: 'P3', blocking: false, grade: result.grade });
        continue;
      }

      blocking = blocking || result.blocking;
      // Rewrite each comment's `file` to the repo-relative path of the file we
      // sent (the model may echo back a different path it inferred from the
      // header) so downstream rendering points to the correct file.
      const filePriority = pickFilePriority(result);
      for (const fc of result.file_comments) {
        allComments.push({ ...fc, file: rel });
      }

      if (result.file_comments.length === 0 && isMeaningful(result.summary)) {
        allComments.push({
          file: rel, line: 1, comment: result.summary, category: '', priority: filePriority,
        });
      }

      grades.push(result.grade);
      if (isMeaningful(result.summary)) {
        summaries.push(`**\`${rel}\`**\n\n${result.summary}`);
        perFile.push({
          file: rel,
          summary: result.summary,
          priority: filePriority,
          blocking: result.blocking,
          grade: result.grade as PerFileSummary['grade'],
        });
      }
    }

    const review: ReviewResult = (summaries.length === 0 && allComments.length === 0)
      ? { summary: 'AI review produced no output.', blocking: false, is_error: false, file_comments: [], grade: '' }
      : {
          summary:       summaries.join('\n\n---\n\n'),
          blocking,
          is_error:      false,
          file_comments: allComments,
          grade:         (worstGrade(grades) as ReviewResult['grade']) || '',
          per_file_summaries: perFile,
        };

    const report = this.assembleReport(relPaths, review, Date.now() - start);
    return { report, stderr: '', timedOut: false, cancelled: false };
  }

  /** Generate a conventional commit message from the current staged diff. */
  async generateCommitMessage(repoRoot: string, signal?: AbortSignal): Promise<CommitMessageResult> {
    let diff: string;
    try {
      diff = (await git(repoRoot, ['diff', '--cached'])).trim();
    } catch (e) {
      return { commit_message: '', is_error: true, error: `git diff failed: ${(e as Error).message}` };
    }
    if (!diff) {
      return { commit_message: '', is_error: true, error: 'No staged changes found.' };
    }

    const req: ProviderRequest = this.buildProviderRequest(
      repoRoot,
      COMMIT_MESSAGE_SYSTEM_PROMPT,
      `Generate a commit message for the following staged diff:\n\n\`\`\`diff\n${diff}\n\`\`\``,
      Math.min(this.cfg.maxTokens, 512),
      signal,
      COMMIT_MESSAGE_OUTPUT_SCHEMA,
    );

    const resp = await callProvider(req);
    if (resp.error) { return { commit_message: '', is_error: true, error: resp.error }; }

    let parsed: any;
    try {
      const stripped = resp.raw.trim()
        .replace(/^```(?:json)?\s*/m, '')
        .replace(/```\s*$/m, '')
        .trim();
      parsed = JSON.parse(stripped);
    } catch (e) {
      return { commit_message: '', is_error: true, error: `Failed to parse model response: ${(e as Error).message}` };
    }
    const msg = String(parsed?.commit_message ?? '').trim();
    if (!msg) {
      return { commit_message: '', is_error: true, error: 'Model returned an empty commit_message.' };
    }
    return { commit_message: msg, is_error: false, error: '' };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async singleCall(opts: {
    repoRoot: string;
    mode: ReviewMode;
    body: string;
    signal?: AbortSignal;
  }): Promise<ReviewResult> {
    const skillsText = loadSkills(opts.repoRoot);
    const systemPrompt = buildSystemPrompt({
      mode: opts.mode,
      severity: this.cfg.severityLevel,
      richness: this.cfg.richnessLevel,
      locale: this.cfg.locale,
      skillsText,
    });
    const userMessage = buildUserMessage(opts.mode, opts.body);

    const req = this.buildProviderRequest(
      opts.repoRoot,
      systemPrompt,
      userMessage,
      this.cfg.maxTokens,
      opts.signal,
      REVIEW_OUTPUT_SCHEMA,
    );
    const resp = await callProvider(req);
    if (resp.error) { return this.errorResult(resp.error); }

    let parsed: ParsedReview;
    try {
      parsed = parseReviewJson(resp.raw);
    } catch (e) {
      return this.errorResult(
        `Could not parse AI response as JSON (max_tokens=${this.cfg.maxTokens}). ` +
        `Raw response head: ${resp.raw.slice(0, 200)}`,
      );
    }

    // Apply P3 text-pattern upgrade and enforce severity floor
    const minRank = SEVERITY_MIN_RANK[this.cfg.severityLevel] ?? 1;
    let comments: FileComment[] = parsed.file_comments
      .map(fc => ({
        ...fc,
        priority: enforceP3(fc.priority, fc.comment),
      } as FileComment))
      .filter(fc => (PRIORITY_RANK[fc.priority] ?? 1) >= minRank);

    // Moderate: cap P1 Info at 2 per file so it doesn't drown out P2/P3
    if (this.cfg.severityLevel === 'moderate') {
      const counts = new Map<string, number>();
      comments = comments.filter(fc => {
        if (fc.priority !== 'P1') { return true; }
        const n = (counts.get(fc.file) ?? 0) + 1;
        counts.set(fc.file, n);
        return n <= 2;
      });
    }

    let summary = parsed.summary;
    if (parsed.truncated) {
      summary = `⚠ Response truncated (max_tokens=${this.cfg.maxTokens}) — ` +
                `increase \`commitDefender.maxTokens\` for a complete review.\n\n${summary}`;
    }

    return {
      summary,
      blocking: parsed.blocking,
      is_error: false,
      file_comments: comments,
      grade: parsed.grade as ReviewResult['grade'],
    };
  }

  private buildProviderRequest(
    repoRoot: string,
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    signal?: AbortSignal,
    responseSchema = REVIEW_OUTPUT_SCHEMA,
  ): ProviderRequest {
    const executablePath = this.cfg.aiProvider === 'codex'
      ? this.cfg.codexPath
      : this.cfg.aiProvider === 'claudecode'
        ? this.cfg.claudeCodePath
        : this.cfg.aiProvider === 'geminicli'
          ? this.cfg.geminiCliPath
          : this.cfg.aiProvider === 'antigravity'
            ? this.cfg.antigravityPath
            : '';
    return {
      provider:    this.cfg.aiProvider,
      apiKey:      this.cfg.apiKey,
      endpoint:    this.cfg.endpoint,
      apiVersion:  this.cfg.apiVersion,
      model:       this.cfg.model,
      maxTokens,
      systemPrompt,
      userMessage,
      workingDirectory: repoRoot,
      executablePath,
      responseSchema,
      signal,
    };
  }

  private assembleReport(stagedFiles: string[], review: ReviewResult, durationMs: number): AnalysisReport {
    const exit_code = review.is_error ? 0 : (review.file_comments.some(c => c.priority === 'P3') ? 1 : (review.blocking ? 1 : 0));
    return {
      schema_version: 1,
      staged_files: stagedFiles,
      duration_ms: durationMs,
      exit_code: exit_code as 0 | 1,
      lint_findings: [],
      review,
    };
  }

  private emptyReport(summary: string): AnalysisReport {
    return {
      schema_version: 1,
      staged_files: [],
      duration_ms: 0,
      exit_code: 0,
      lint_findings: [],
      review: { summary, blocking: false, is_error: false, file_comments: [], grade: '' },
    };
  }

  private errorReport(message: string): AnalysisReport {
    return {
      schema_version: 1,
      staged_files: [],
      duration_ms: 0,
      exit_code: 0,
      lint_findings: [],
      review: this.errorResult(message),
    };
  }

  private errorResult(message: string): ReviewResult {
    return {
      summary: `AI review unavailable: ${message}`,
      blocking: false,
      is_error: true,
      file_comments: [],
      grade: '',
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickFilePriority(result: ReviewResult): FileComment['priority'] {
  if (result.file_comments.length > 0) {
    let worst: FileComment['priority'] = 'P0';
    for (const fc of result.file_comments) {
      if ((PRIORITY_RANK[fc.priority] ?? 1) > (PRIORITY_RANK[worst] ?? 1)) { worst = fc.priority; }
    }
    return worst;
  }
  if (result.blocking) { return 'P3'; }
  if (result.grade === 'critical' || result.grade === 'insufficient') { return 'P2'; }
  return 'P1';
}

function worstGrade(grades: string[]): string {
  let worst = '';
  let worstRank = Number.POSITIVE_INFINITY;
  for (const g of grades) {
    const rank = GRADE_RANK[g];
    if (rank !== undefined && rank < worstRank) { worstRank = rank; worst = g; }
  }
  return worst;
}

// resolveExitCode is re-exported for callers that need it standalone.
export { resolveExitCode };
