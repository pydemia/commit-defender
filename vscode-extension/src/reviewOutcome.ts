import type { AnalysisReport, ReviewResult, ReviewStatus } from './types.js';

/** Legacy reports have no status. Do not infer status from model-authored prose. */
export function reviewStatus(review: ReviewResult): ReviewStatus {
  if (review.is_error) return 'failed';
  return review.status ?? 'completed';
}

export const OUTCOME_META = {
  completed: { label: 'Completed', icon: 'check', color: 'terminal.ansiGreen' },
  partial: { label: 'Partial', icon: 'warning', color: 'terminal.ansiYellow' },
  failed: { label: 'Failed', icon: 'error', color: 'terminal.ansiRed' },
  cancelled: {
    label: 'Cancelled',
    icon: 'circle-slash',
    color: 'descriptionForeground',
  },
} as const;

export function reviewCoverage(report: AnalysisReport): string {
  const outcomes = report.review.per_file_summaries;
  if (!outcomes?.length) {
    return `${reviewStatus(report.review) === 'completed' ? report.staged_files.length : 0}/${report.staged_files.length} selected file(s) completed`;
  }
  const counts = new Map<string, number>();
  for (const entry of outcomes) {
    const state = entry.status ?? 'completed';
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const details = ['partial', 'failed', 'cancelled', 'not-run']
    .filter((state) => counts.has(state))
    .map((state) => `${counts.get(state)} ${state}`);
  return [
    `${counts.get('completed') ?? 0}/${report.staged_files.length} selected file(s) completed`,
    ...details,
  ].join('; ');
}
