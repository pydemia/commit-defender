import type { AnalysisReport, ReviewResult, ReviewStatus } from './types.js';

/** Legacy reports have no status. Do not infer status from model-authored prose. */
export function reviewStatus(review: ReviewResult): ReviewStatus {
  if (review.is_error) return 'failed';
  return review.status ?? 'completed';
}

/** Prefer the validated review problem over the generic projected summary. */
export function reviewFailureMessage(
  report: AnalysisReport,
  locale: 'en' | 'ko',
): string {
  const problem = report.gcr?.report.problems[0];
  if (problem?.code === 'invalid-output') {
    const reason = /^Review response rejected \(([a-z-]+)\):/.exec(
      problem.message,
    )?.[1];
    if (locale === 'ko') {
      if (reason === 'unknown-read-id')
        return '모델 응답이 이번 리뷰에서 발급되지 않은 source read ID를 '
          + '참조했습니다 (unknown-read-id). 결과가 거부됐으므로 다시 분석해 주세요.';
      if (reason === 'invalid-json')
        return '모델 응답이 올바른 JSON이 아니어서 결과가 거부됐습니다 '
          + '(invalid-json). 다시 분석해 주세요.';
      if (reason === 'invalid-schema')
        return '모델 응답이 리뷰 응답 형식에 맞지 않아 결과가 거부됐습니다 '
          + '(invalid-schema). 다시 분석해 주세요.';
      return `모델 응답이 검증에 실패했습니다. ${problem.message}`;
    }
    return problem.message;
  }
  if (problem && !problem.message.startsWith('No complete review is available'))
    return problem.message;
  const summary = report.review.summary.replace(/^AI review unavailable:\s*/i, '');
  if (summary !== 'Review did not complete.') return summary;
  if (!problem)
    return locale === 'ko' ? '리뷰가 완료되지 않았습니다.' : summary;
  return locale === 'ko'
    ? `리뷰가 완료되지 않았습니다 (${problem.code}). 세부 원인은 보고서에 기록되지 않았습니다.`
    : `Review did not complete (${problem.code}). The report has no further cause.`;
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
