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

import { createHash } from 'crypto';
import { ResolvedConfig } from '../config.js';
import { formatFileContent, truncate, MAX_CONTENT_CHARS } from '../diff.js';
import { captureStagedSnapshot, type StagedSnapshot } from '../gitSnapshot.js';
import { captureWorkingFiles, type CapturedFiles } from '../reviewInput.js';
import { attachReviewSources, validateFindingAnchors } from '../reviewSource.js';
import { reviewStatus } from '../reviewOutcome.js';
import { resolveExitCode } from '../exitResolver.js';
import { applyMarkers } from '../skipMarkers.js';
import { loadSkillMaterial } from '../skills.js';
import { AnalysisReport, CommitMessageResult, FileComment, IncompleteReason, PerFileSummary, ReviewResult, ReviewStatus, RunResult } from '../types.js';
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
  constructor(private readonly cfg: ResolvedConfig, private readonly material?: ReturnType<typeof loadSkillMaterial>) {}

  /** Pre-commit / staged scope: send the combined diff in a single call. */
  async reviewDiff(repoRoot: string, stagedFiles: string[], signal?: AbortSignal, prepared?: StagedSnapshot | Error): Promise<RunResult> {
    const start = Date.now();
    let source: Pick<AnalysisReport, 'source_exclusions' | 'source_snapshot'> = {};
    try {
      if (signal?.aborted) return this.interrupted(stagedFiles, start, signal);
      if (prepared instanceof Error) throw prepared;
      const snapshot = prepared ?? captureStagedSnapshot(repoRoot, this.cfg.excludePatterns);
      stagedFiles = stagedFiles.filter(file => snapshot.files.includes(file));
      source = {
        source_exclusions: snapshot.excluded,
        source_snapshot: { kind: 'index', base_commit: snapshot.baseCommit, base_tree: snapshot.baseTree, source_tree: snapshot.sourceTree },
      };
      if (!stagedFiles.length) throw new Error('No permitted staged source files. Review was not run.');
      const diff = snapshot.diff(stagedFiles);
      if (!diff.trim()) throw new Error('No permitted staged source content. Review was not run.');
      const sources = new Map(stagedFiles.map(file => [file, snapshot.readSelected(file)]));
      const review = await this.singleCall({
        repoRoot, mode: 'diff', body: truncate(diff), sourceTruncated: diff.length > MAX_CONTENT_CHARS, signal,
      });
      validateFindingAnchors(review, sources);
      review.file_comments = applyMarkers(review.file_comments, sources);
      const report = { ...this.assembleReport(stagedFiles, review, Date.now() - start), ...source };
      attachReviewSources(report, sources, snapshot.sideOf);
      return this.runResult(report);
    } catch (error) {
      if ((error as Error).name === 'AbortError' || signal?.aborted) {
        const result = this.interrupted(stagedFiles, start, signal);
        Object.assign(result.report, source);
        return result;
      }
      return this.runResult({ ...this.assembleReport(stagedFiles, this.errorResult((error as Error).message, 'source-error'), Date.now() - start), ...source });
    }
  }

  /** On-demand scope: freeze source first, then preserve each file's actual outcome. */
  async reviewFilesSeparately(
    repoRoot: string,
    relPaths: string[],
    signal?: AbortSignal,
    onProgress?: ProgressCb,
    prepared?: CapturedFiles | Error,
  ): Promise<RunResult> {
    const start = Date.now();
    if (signal?.aborted) return this.interrupted(relPaths, start, signal);
    let captured: CapturedFiles;
    try {
      if (prepared instanceof Error) throw prepared;
      captured = prepared ?? captureWorkingFiles(repoRoot, relPaths, this.cfg.excludePatterns);
      relPaths = captured.files;
    } catch (error) {
      return this.runResult(this.assembleReport(relPaths, this.errorResult((error as Error).message, 'source-error'), Date.now() - start));
    }
    const { exclusions, sources, readErrors } = captured;
    if (!relPaths.length) {
      const report = this.assembleReport([], this.errorResult('No permitted source files. Review was not run.', 'source-error'), Date.now() - start);
      report.source_exclusions = exclusions;
      return this.runResult(report);
    }
    const allComments: FileComment[] = [];
    const perFile: PerFileSummary[] = [];
    const grades: string[] = [];
    const reasons = new Set<IncompleteReason>();
    let rejected = 0;
    let blocking = false;
    let cancelled = false;

    for (let i = 0; i < relPaths.length; i++) {
      if (signal?.aborted) {
        cancelled = signal.reason !== 'timeout' && signal.reason?.name !== 'TimeoutError';
        reasons.add(cancelled ? 'cancelled' : 'timeout');
        break;
      }
      const file = relPaths[i];
      let result: ReviewResult;
      try {
        onProgress?.(i + 1, relPaths.length, file);
        if (readErrors.has(file)) {
          result = this.errorResult(readErrors.get(file)!.message, 'source-error');
        } else {
          const content = formatFileContent(file, sources.get(file)!);
          result = await this.singleCall({ repoRoot, mode: 'file', body: truncate(content), sourceTruncated: content.length > MAX_CONTENT_CHARS, signal });
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          result = this.cancelledResult();
          cancelled = true;
        } else { result = this.errorResult((error as Error).message); }
      }
      validateFindingAnchors(result, new Map(sources.has(file) ? [[file, sources.get(file)!]] : []), file);
      const status = reviewStatus(result);
      result.file_comments = applyMarkers(result.file_comments, sources);
      for (const reason of result.incomplete_reasons ?? []) reasons.add(reason);
      rejected += result.rejected_finding_count ?? 0;
      const usable = status === 'completed' || status === 'partial';
      if (usable) {
        allComments.push(...result.file_comments);
        blocking ||= result.blocking;
        grades.push(result.grade);
      }
      perFile.push({
        file, summary: result.summary, status,
        priority: usable && (result.file_comments.length || result.blocking) ? pickFilePriority(result) : undefined,
        blocking: usable && result.blocking, grade: usable ? result.grade : '',
      });
      if (cancelled) break;
    }
    for (const file of relPaths.slice(perFile.length)) {
      perFile.push({ file, summary: 'Review was not run.', status: 'not-run', blocking: false, grade: '' });
    }
    const usable = perFile.filter(entry => entry.status === 'completed' || entry.status === 'partial').length;
    const status: ReviewStatus = cancelled ? 'cancelled'
      : usable === 0 ? 'failed'
      : perFile.every(entry => entry.status === 'completed') ? 'completed' : 'partial';
    const review: ReviewResult = {
      summary: perFile.map(entry => `**\`${entry.file}\`** — ${entry.status}\n\n${entry.summary}`).join('\n\n---\n\n'),
      status, blocking, is_error: status === 'failed', file_comments: allComments,
      grade: status === 'completed' ? worstGrade(grades) as ReviewResult['grade'] : '',
      incomplete_reasons: [...reasons], rejected_finding_count: rejected, per_file_summaries: perFile,
    };
    const report = this.assembleReport(relPaths, review, Date.now() - start);
    report.source_exclusions = exclusions;
    report.source_snapshot = { kind: 'working-tree', content_sha256: Object.fromEntries(
      [...sources].map(([file, text]) => [file, createHash('sha256').update(text).digest('hex')]),
    ) };
    attachReviewSources(report, sources);
    return this.runResult(report);
  }

  /** Generate a conventional commit message from the current staged diff. */
  async generateCommitMessage(repoRoot: string, signal?: AbortSignal, prepared?: string | Error): Promise<CommitMessageResult> {
    let diff: string;
    try {
      if (prepared instanceof Error) throw prepared;
      if (prepared !== undefined) diff = prepared;
      else {
        const selection = captureStagedSnapshot(repoRoot, this.cfg.excludePatterns);
        if (selection.excluded.length) {
          return { commit_message: '', is_error: true,
            error: `Commit message was not generated: ${selection.excluded.length} staged path(s) are excluded by source policy.` };
        }
        diff = truncate(selection.diff()).trim();
      }
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
    sourceTruncated?: boolean;
    signal?: AbortSignal;
  }): Promise<ReviewResult> {
    const { text: skillsText, truncated: skillsTruncated } = this.material ?? loadSkillMaterial(opts.repoRoot, this.cfg.excludePatterns);
    const systemPrompt = buildSystemPrompt({
      mode: opts.mode,
      severity: this.cfg.severityLevel,
      richness: this.cfg.richnessLevel,
      locale: this.cfg.locale,
      skillsText,
    });
    const userMessage = buildUserMessage(opts.mode, opts.body, skillsText);

    const req = this.buildProviderRequest(
      opts.repoRoot,
      systemPrompt,
      userMessage,
      this.cfg.maxTokens,
      opts.signal,
      REVIEW_OUTPUT_SCHEMA,
    );
    const resp = await callProvider(req);
    if (resp.error) { return this.errorResult(resp.error, resp.errorKind === 'timeout' ? 'timeout' : 'provider-error'); }

    let parsed: ParsedReview;
    try {
      parsed = parseReviewJson(resp.raw);
    } catch (e) {
      return this.errorResult(
        `Could not parse AI response as JSON (max_tokens=${this.cfg.maxTokens}). ` +
        'Provider output did not contain a usable review.',
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
    if (parsed.truncated || resp.incomplete) {
      summary = `Provider response is incomplete; findings may be missing.\n\n${summary}`;
    }

    const reasons: IncompleteReason[] = [];
    if (parsed.rejectedComments) reasons.push('invalid-output');
    if (opts.sourceTruncated) reasons.push('source-truncated');
    if (skillsTruncated) {
      reasons.push('context-truncated');
      summary = `Repository review material exceeded the input limit; only part was included.\n\n${summary}`;
    }
    if (parsed.truncated) reasons.push('response-truncated');
    else if (resp.incomplete) reasons.push('response-incomplete');
    if (opts.sourceTruncated) summary = `Source exceeded the input limit; only part of it was reviewed.\n\n${summary}`;
    return {
      summary,
      status: reasons.length ? 'partial' : 'completed',
      incomplete_reasons: reasons,
      rejected_finding_count: parsed.rejectedComments,
      blocking: parsed.blocking,
      is_error: false,
      file_comments: comments,
      grade: reasons.length ? '' : parsed.grade as ReviewResult['grade'],
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
    const report: AnalysisReport = {
      schema_version: 1, staged_files: stagedFiles, duration_ms: durationMs,
      exit_code: 0, lint_findings: [], review,
    };
    report.exit_code = resolveExitCode(report);
    return report;
  }

  private runResult(report: AnalysisReport): RunResult {
    return { report, stderr: '', timedOut: report.review.incomplete_reasons?.includes('timeout') ?? false, cancelled: reviewStatus(report.review) === 'cancelled' };
  }

  private interrupted(files: string[], start: number, signal?: AbortSignal): RunResult {
    const timedOut = signal?.reason === 'timeout' || signal?.reason?.name === 'TimeoutError';
    const review = timedOut ? this.errorResult('AI request timed out.', 'timeout') : this.cancelledResult();
    return this.runResult(this.assembleReport(files, review, Date.now() - start));
  }

  private cancelledResult(): ReviewResult {
    return { summary: 'Review was cancelled.', status: 'cancelled', incomplete_reasons: ['cancelled'], blocking: false, is_error: false, file_comments: [], grade: '' };
  }

  private errorResult(message: string, reason: IncompleteReason = 'provider-error'): ReviewResult {
    return { summary: `AI review unavailable: ${message}`, status: 'failed', incomplete_reasons: [reason], blocking: false, is_error: true, file_comments: [], grade: '' };
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
