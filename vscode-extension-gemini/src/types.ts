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

export interface FileComment {
  /** Repo-relative path */
  file: string;
  /** 1-based line number; 0 = file-level comment */
  line: number;
  /** Markdown-formatted actionable suggestion */
  comment: string;
  /** Review category tag */
  category: CommentCategory;
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
}
