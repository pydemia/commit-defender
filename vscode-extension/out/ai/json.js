"use strict";
/**
 * Parse JSON returned by the model. Tolerant of markdown fences and partial
 * truncation — mirrors the recovery strategy in the Python `_parse_json`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseReviewJson = parseReviewJson;
exports.enforceP3 = enforceP3;
function parseReviewJson(raw) {
    const truncated = !raw.trim().replace(/`+\s*$/, '').endsWith('}');
    const data = robustJson(raw);
    const validPriorities = new Set(['P0', 'P1', 'P2', 'P3']);
    const validCategories = new Set([
        'correctness', 'security', 'maintenance',
        'optimization', 'review-history', 'setting',
    ]);
    const validGrades = new Set(['exceptional', 'proficient', 'adequate', 'insufficient', 'critical']);
    const fcRaw = Array.isArray(data?.file_comments) ? data.file_comments : [];
    const file_comments = fcRaw
        .filter(fc => fc && typeof fc.file === 'string' && typeof fc.comment === 'string')
        .map(fc => {
        const rawPri = String(fc.priority ?? 'P1').toUpperCase();
        const rawCat = String(fc.category ?? '').toLowerCase();
        return {
            file: String(fc.file),
            line: Number.isFinite(+fc.line) ? Math.max(0, Math.floor(+fc.line)) : 0,
            comment: String(fc.comment),
            category: validCategories.has(rawCat) ? rawCat : '',
            priority: validPriorities.has(rawPri) ? rawPri : 'P1',
        };
    });
    const grade = validGrades.has(String(data?.grade ?? '').toLowerCase())
        ? String(data.grade).toLowerCase()
        : '';
    return {
        summary: typeof data?.summary === 'string' ? data.summary : '(no summary)',
        blocking: Boolean(data?.blocking),
        grade,
        file_comments,
        truncated,
    };
}
function robustJson(raw) {
    // 1. Direct parse
    try {
        return JSON.parse(raw);
    }
    catch { /* continue */ }
    // 2. Strip markdown fences
    const stripped = raw.trim()
        .replace(/^```(?:json)?\s*/m, '')
        .replace(/```\s*$/m, '')
        .trim();
    try {
        return JSON.parse(stripped);
    }
    catch { /* continue */ }
    // 3. First complete top-level {...} block
    let depth = 0;
    let start = null;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '{') {
            if (start === null) {
                start = i;
            }
            depth++;
        }
        else if (ch === '}') {
            depth--;
            if (depth === 0 && start !== null) {
                try {
                    return JSON.parse(raw.slice(start, i + 1));
                }
                catch { /* continue */ }
                start = null;
            }
        }
    }
    // 4. Repair truncated JSON — close all open brackets/strings
    const open = raw.indexOf('{');
    if (open !== -1) {
        const repaired = repairTruncated(raw.slice(open));
        try {
            return JSON.parse(repaired);
        }
        catch { /* fall through */ }
    }
    throw new Error('No valid JSON found in response');
}
function repairTruncated(text) {
    const stack = [];
    let inString = false;
    let escapeNext = false;
    for (const ch of text) {
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (ch === '\\' && inString) {
            escapeNext = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (ch === '{' || ch === '[') {
            stack.push(ch);
        }
        else if (ch === '}' && stack[stack.length - 1] === '{') {
            stack.pop();
        }
        else if (ch === ']' && stack[stack.length - 1] === '[') {
            stack.pop();
        }
    }
    let suffix = inString ? '"' : '';
    for (let i = stack.length - 1; i >= 0; i--) {
        suffix += stack[i] === '{' ? '}' : ']';
    }
    return text + suffix;
}
// ── P3 enforcement ──────────────────────────────────────────────────────────
const P3_PATTERNS = new RegExp([
    'syntax error', 'syntaxerror',
    'import error', 'importerror',
    'parse error', 'cannot be parsed', 'fails to parse', '파싱',
    'undefined variable', 'nameerror', 'attributeerror',
    'cannot be executed', "won't run", 'will not run', '실행.*불가', '불가.*실행',
    'incomplete (import|statement|expression|syntax)',
    'missing (colon|parenthes|bracket|quote)',
    'security (vulnerabilit|risk|flaw)', '취약', 'injection',
    'secret.*expos', 'hardcoded.*(key|secret|password|token)',
    'data.?loss', 'data.?corrupt', 'unrecoverable',
    '문법 오류', '구문 오류', '임포트 오류',
].join('|'), 'i');
/** Upgrade priority to P3 when comment text describes an inherently critical issue. */
function enforceP3(priority, commentText) {
    if (priority === 'P3') {
        return 'P3';
    }
    return P3_PATTERNS.test(commentText) ? 'P3' : priority;
}
//# sourceMappingURL=json.js.map