/**
 * Resolve the final exit code for a hook run.
 *
 * Without rule-based linting in the extension, the only blocking signals are:
 *   1. Any P3 (Critical) AI comment.
 *   2. The model's own `blocking: true` flag.
 *
 * AI errors do NOT block — a network hiccup must not prevent a commit from
 * landing. The user can always `git commit --no-verify` for emergencies.
 */

import { AnalysisReport } from './types.js';
import { reviewStatus } from './reviewOutcome.js';

export type EnforcementPolicy = 'legacy-hook' | 'advisory';

export function resolveExitCode(report: AnalysisReport, policy: EnforcementPolicy = 'legacy-hook'): 0 | 1 {
  // New automatic review uses advisory explicitly; existing hooks keep their policy.
  // A zero enforcement code does not prove that the review completed.
  if (policy === 'advisory') return 0;
  const status = reviewStatus(report.review);
  if (status === 'failed' || status === 'cancelled') { return 0; }
  if (report.review.file_comments.some(c => c.priority === 'P3')) { return 1; }
  if (report.review.blocking) { return 1; }
  return 0;
}
