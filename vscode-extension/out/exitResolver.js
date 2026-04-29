"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveExitCode = resolveExitCode;
function resolveExitCode(report) {
    if (report.review.is_error) {
        return 0;
    }
    if (report.review.file_comments.some(c => c.priority === 'P3')) {
        return 1;
    }
    if (report.review.blocking) {
        return 1;
    }
    return 0;
}
//# sourceMappingURL=exitResolver.js.map