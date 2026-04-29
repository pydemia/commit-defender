/**
 * Inline skip directives — drop AI findings on lines marked with:
 *   # CD:skip            — explicit suppression
 *   # CD:skip:<reason>   — same; reason is a human note
 *   # type: ignore       — type-checker suppression
 *   # TODO               — known unfinished work
 *
 * Markers are language-agnostic: we match on `#`-style comments because that's
 * what the original Python implementation supported, and the markers are meant
 * to be developer signals rather than syntax-aware.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FileComment } from './types.js';

const PATTERNS: RegExp[] = [
  /#\s*CD\s*:\s*skip/i,
  /#\s*type\s*:\s*ignore/,
  /#\s*TODO\b/i,
];

function isMarked(line: string): boolean {
  return PATTERNS.some(re => re.test(line));
}

function scanFile(absPath: string): Set<number> {
  const marked = new Set<number>();
  let text: string;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch { return marked; }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (isMarked(lines[i])) { marked.add(i + 1); }
  }
  return marked;
}

/** Drop file comments that land on a marker line. Returns a new array. */
export function applyMarkers(
  comments: FileComment[],
  staged: string[],
  repoRoot: string,
): FileComment[] {
  const skipMap = new Map<string, Set<number>>();
  for (const rel of staged) {
    const lines = scanFile(path.join(repoRoot, rel));
    if (lines.size > 0) { skipMap.set(rel, lines); }
  }
  if (skipMap.size === 0) { return comments; }
  return comments.filter(c => !skipMap.get(c.file)?.has(c.line));
}
