/**
 * Git diff and file content extraction. Pure-TS replacement for the Python
 * DiffExtractor.
 */

import * as path from 'path';
import { captureStagedSnapshot } from './gitSnapshot.js';
import { readReviewFile, selectReviewInputs, type ExclusionObserver } from './sourcePolicy.js';

/** Cap diff/file content size to keep token usage bounded (~25K tokens). */
export const MAX_CONTENT_CHARS = 80_000;

/** The diff and marker source can share a single captured snapshot. */
export async function getStagedDiff(repoRoot: string, relPaths: string[], patterns: string[] = []): Promise<string> {
  if (relPaths.length === 0) return '';
  return truncate(captureStagedSnapshot(repoRoot, patterns).diff(relPaths));
}

/**
 * Read full file contents wrapped in fenced code blocks, one section per file.
 * Used by on-demand (file/directory/repository) analysis where the AI gets the
 * whole file rather than the staged hunk.
 */
export function getFileContents(repoRoot: string, relPaths: string[], patterns: string[] = [], onExcluded?: ExclusionObserver): string {
  if (relPaths.length === 0) { return ''; }
  const selection = selectReviewInputs(repoRoot, relPaths, patterns);
  selection.excluded.forEach(entry => onExcluded?.(entry));
  const parts: string[] = [];
  for (const rel of selection.files) {
    const content = readReviewFile(repoRoot, rel, patterns);
    parts.push(formatFileContent(rel, content));
  }
  return truncate(parts.join('\n\n'));
}

export function formatFileContent(file: string, content: string): string {
  const ext = path.extname(file).replace(/^\./, '');
  return `### ${file}\n\n\`\`\`${ext}\n${content}\n\`\`\``;
}

export function truncate(s: string): string {
  if (s.length <= MAX_CONTENT_CHARS) { return s; }
  return s.slice(0, MAX_CONTENT_CHARS) + '\n\n[... truncated for token limit ...]';
}
