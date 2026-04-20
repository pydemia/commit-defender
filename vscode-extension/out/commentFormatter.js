"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRIORITY_RANK = void 0;
exports.hasValidPriority = hasValidPriority;
exports.severityToPriority = severityToPriority;
exports.formatCategory = formatCategory;
exports.metaForBlock = metaForBlock;
exports.metaForComment = metaForComment;
exports.metaForLintFinding = metaForLintFinding;
exports.metaForPriority = metaForPriority;
exports.normalizeReport = normalizeReport;
exports.worstPriority = worstPriority;
const types_js_1 = require("./types.js");
const VALID_PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);
/** Returns true if the FileComment has a recognised priority. */
function hasValidPriority(fc) {
    return VALID_PRIORITIES.has(fc.priority);
}
/** Map a linter severity string to a CommentPriority. */
function severityToPriority(severity) {
    if (severity === 'error') {
        return 'P3';
    }
    if (severity === 'warning') {
        return 'P2';
    }
    return 'P1';
}
/** Capitalise a category slug, e.g. "correctness" → "Correctness". */
function formatCategory(category) {
    if (!category) {
        return 'Review';
    }
    return category.charAt(0).toUpperCase() + category.slice(1);
}
/** Numeric rank for sorting: P3=3 (worst) … P0=0 (best). */
exports.PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
/**
 * Return the PRIORITY_META entry for a CommentBlock.
 * Throws if priority is unrecognised — the AI or linter must always set it.
 */
function metaForBlock(b) {
    const meta = types_js_1.PRIORITY_META[b.priority];
    if (!meta) {
        throw new Error(`CommentBlock has invalid priority: "${b.priority}" (${b.file}:${b.line})`);
    }
    return meta;
}
/** Return the PRIORITY_META entry for a FileComment's priority. */
function metaForComment(fc) {
    const meta = types_js_1.PRIORITY_META[fc.priority];
    if (!meta) {
        throw new Error(`FileComment has no valid priority: "${fc.priority}" (file: ${fc.file} line: ${fc.line})`);
    }
    return meta;
}
/** Return the PRIORITY_META entry for a LintFinding's severity. */
function metaForLintFinding(f) {
    return types_js_1.PRIORITY_META[severityToPriority(f.severity)];
}
/** Return PRIORITY_META for a raw CommentPriority string. */
function metaForPriority(p) {
    return types_js_1.PRIORITY_META[p];
}
/**
 * Convert a full AnalysisReport into a flat, sorted CommentBlock[].
 * This is the ONLY place where lint findings and AI comments are merged.
 * Order: P3 first → P0 last. Within the same priority: lint before ai, then by line.
 */
function normalizeReport(report) {
    const blocks = [];
    for (const f of report.lint_findings) {
        blocks.push({
            file: f.file,
            line: f.line,
            col: f.col,
            priority: severityToPriority(f.severity),
            category: 'correctness',
            comment: f.message,
            source: 'lint',
            rule: f.rule,
        });
    }
    for (const fc of report.review.file_comments) {
        if (!hasValidPriority(fc)) {
            continue;
        }
        blocks.push({
            file: fc.file,
            line: fc.line,
            priority: fc.priority,
            category: fc.category || '',
            comment: fc.comment,
            source: 'ai',
        });
    }
    return blocks.sort((a, b) => {
        const ra = exports.PRIORITY_RANK[a.priority] ?? 1;
        const rb = exports.PRIORITY_RANK[b.priority] ?? 1;
        if (rb !== ra) {
            return rb - ra;
        }
        if (a.source !== b.source) {
            return a.source === 'lint' ? -1 : 1;
        }
        return a.line - b.line;
    });
}
/**
 * Return the single worst CommentPriority across all blocks.
 * Worst = highest rank (P3 beats P2 beats P1 beats P0).
 */
function worstPriority(blocks) {
    let worst;
    let worstRank = -1;
    for (const b of blocks) {
        const r = exports.PRIORITY_RANK[b.priority] ?? -1;
        if (r > worstRank) {
            worstRank = r;
            worst = b.priority;
        }
    }
    return worst;
}
//# sourceMappingURL=commentFormatter.js.map