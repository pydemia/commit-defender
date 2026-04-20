/** TypeScript interfaces matching the Python JSON output schema (schema_version: 1). */

export type Severity = 'error' | 'warning' | 'info';

export interface LintFinding {
  /** Repo-relative path, e.g. "src/main.py" */
  file: string;
  /** 1-based line number */
  line: number;
  /** 1-based column number */
  col: number;
  rule: string;
  message: string;
  severity: Severity;
}

export type CommentCategory =
  | 'correctness' | 'security' | 'maintenance'
  | 'optimization' | 'review-history' | 'setting' | '';

export type CommentPriority = 'P0' | 'P1' | 'P2' | 'P3';

export const PRIORITY_META: Record<CommentPriority, { label: string; emoji: string; color: string }> = {
  P0: { label: 'Praise',   emoji: '🟩', color: '#22c55e' },
  P1: { label: 'Info',     emoji: '🟦', color: '#3b82f6' },
  P2: { label: 'Warning',  emoji: '🟧', color: '#f97316' },
  P3: { label: 'Critical', emoji: '🟥', color: '#ef4444' },
};

export interface FileComment {
  /** Repo-relative path */
  file: string;
  /** 1-based line number; 0 = file-level comment */
  line: number;
  /** Markdown-formatted actionable suggestion */
  comment: string;
  /** Review category tag */
  category: CommentCategory;
  /** Acceptance level: P0=Praise P1=Nitpick P2=Suggestion P3=Critical */
  priority: CommentPriority;
}

/** Unified atomic unit for any analysis finding — lint or AI. */
export interface CommentBlock {
  file: string;
  line: number;       // 1-based; 0 = file-level
  col?: number;       // 1-based, optional (lint only)
  priority: CommentPriority;
  category: string;   // e.g. correctness, security, maintenance, optimization, setting
  comment: string;    // plain text or markdown body (no rule prefix)
  source: 'lint' | 'ai';
  rule?: string;      // lint rule code only, e.g. "E501"
}

export type Grade = 'exceptional' | 'proficient' | 'adequate' | 'insufficient' | 'critical' | '';

export interface ReviewResult {
  summary: string;
  blocking: boolean;
  is_error: boolean;
  file_comments: FileComment[];
  grade: Grade;
}

export interface AnalysisReport {
  schema_version: 1;
  staged_files: string[];
  duration_ms: number;
  exit_code: 0 | 1;
  lint_findings: LintFinding[];
  review: ReviewResult;
}

/** Internal result from DockerRunner */
export interface RunResult {
  report: AnalysisReport;
  /** Raw stderr output (ANSI) for the output channel */
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}
