/**
 * Parse JSON returned by the model. Tolerant of markdown fences and partial
 * truncation — mirrors the recovery strategy in the Python `_parse_json`.
 */

export interface ParsedReview {
  summary: string;
  blocking: boolean;
  grade: string;
  file_comments: Array<{
    file: string;
    line: number;
    comment: string;
    category: string;
    priority: string;
  }>;
  /** True when the input did not end with a closing brace (likely truncated). */
  truncated: boolean;
  rejectedComments: number;
}

export function parseReviewJson(raw: string): ParsedReview {
  const { data, repaired: truncated } = robustJson(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || typeof data.summary !== 'string'
      || (data.blocking !== undefined && typeof data.blocking !== 'boolean')
      || (data.file_comments !== undefined && !Array.isArray(data.file_comments))
      || (!truncated && (typeof data.blocking !== 'boolean' || !Array.isArray(data.file_comments)))) {
    throw new Error('Model response does not contain a review object');
  }

  const validPriorities = new Set(['P0', 'P1', 'P2', 'P3']);
  const validCategories = new Set([
    'correctness', 'security', 'maintenance',
    'optimization', 'review-history', 'setting',
  ]);
  const validGrades = new Set(['exceptional', 'proficient', 'adequate', 'insufficient', 'critical']);

  const fcRaw: any[] = Array.isArray(data?.file_comments) ? data.file_comments : [];
  const file_comments = fcRaw
    .filter(fc => fc && typeof fc.file === 'string' && typeof fc.comment === 'string'
      && Number.isSafeInteger(fc.line) && fc.line >= 0
      && typeof fc.priority === 'string' && validPriorities.has(fc.priority.toUpperCase()))
    .map(fc => {
      const rawCat = String(fc.category ?? '').toLowerCase();
      return { file: fc.file, line: fc.line, comment: fc.comment,
        category: validCategories.has(rawCat) ? rawCat : '', priority: fc.priority.toUpperCase() };
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
    rejectedComments: fcRaw.length - file_comments.length,
  };
}

function robustJson(raw: string): { data: any; repaired: boolean } {
  // 1. Direct parse
  try { return { data: JSON.parse(raw), repaired: false }; } catch { /* continue */ }

  // 2. Strip markdown fences
  const stripped = raw.trim()
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();
  try { return { data: JSON.parse(stripped), repaired: false }; } catch { /* continue */ }

  // 3. First complete top-level {...} block
  let depth = 0;
  let start: number | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '{') {
      if (start === null) { start = i; }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== null) {
        try { return { data: JSON.parse(raw.slice(start, i + 1)), repaired: false }; } catch { /* continue */ }
        start = null;
      }
    }
  }

  // 4. Repair truncated JSON — close all open brackets/strings
  const open = raw.indexOf('{');
  if (open !== -1) {
    const repaired = repairTruncated(raw.slice(open));
    try { return { data: JSON.parse(repaired), repaired: true }; } catch { /* fall through */ }
  }

  throw new Error('No valid JSON found in response');
}

function repairTruncated(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escapeNext = false;

  for (const ch of text) {
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\' && inString) { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) { continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); }
    else if (ch === '}' && stack[stack.length - 1] === '{') { stack.pop(); }
    else if (ch === ']' && stack[stack.length - 1] === '[') { stack.pop(); }
  }

  let suffix = inString ? '"' : '';
  for (let i = stack.length - 1; i >= 0; i--) {
    suffix += stack[i] === '{' ? '}' : ']';
  }
  return text + suffix;
}

// ── P3 enforcement ──────────────────────────────────────────────────────────

const P3_PATTERNS = new RegExp(
  [
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
  ].join('|'),
  'i',
);

/** Upgrade priority to P3 when comment text describes an inherently critical issue. */
export function enforceP3(priority: string, commentText: string): string {
  if (priority === 'P3') { return 'P3'; }
  return P3_PATTERNS.test(commentText) ? 'P3' : priority;
}
