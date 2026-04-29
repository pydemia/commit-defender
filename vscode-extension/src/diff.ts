/**
 * Git diff and file content extraction. Pure-TS replacement for the Python
 * DiffExtractor.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** Cap diff/file content size to keep token usage bounded (~25K tokens). */
export const MAX_CONTENT_CHARS = 80_000;

/** Empty-tree SHA used as the diff base on the very first commit. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Promise wrapper around `git -C <repoRoot> <args...>`. */
export function git(repoRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repoRoot, ...args], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`git ${args.join(' ')} failed: ${stderr.trim() || err.message}`);
        (e as NodeJS.ErrnoException).code = (err as NodeJS.ErrnoException).code;
        return reject(e);
      }
      resolve(stdout);
    });
  });
}

/**
 * Combined unified diff for the listed staged files. Falls back to diffing
 * against the empty tree when there is no HEAD yet (initial commit).
 */
export async function getStagedDiff(repoRoot: string, relPaths: string[]): Promise<string> {
  if (relPaths.length === 0) { return ''; }
  let out: string;
  try {
    out = await git(repoRoot, ['diff', '--cached', '--diff-filter=d', '--', ...relPaths]);
  } catch {
    out = await git(repoRoot, ['diff', '--cached', '--diff-filter=d', EMPTY_TREE, '--', ...relPaths]);
  }
  return truncate(out);
}

/**
 * Read full file contents wrapped in fenced code blocks, one section per file.
 * Used by on-demand (file/directory/repository) analysis where the AI gets the
 * whole file rather than the staged hunk.
 */
export function getFileContents(repoRoot: string, relPaths: string[]): string {
  if (relPaths.length === 0) { return ''; }
  const parts: string[] = [];
  for (const rel of relPaths) {
    const abs = path.join(repoRoot, rel);
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const ext = path.extname(rel).replace(/^\./, '');
    parts.push(`### ${rel}\n\n\`\`\`${ext}\n${content}\n\`\`\``);
  }
  return truncate(parts.join('\n\n'));
}

function truncate(s: string): string {
  if (s.length <= MAX_CONTENT_CHARS) { return s; }
  return s.slice(0, MAX_CONTENT_CHARS) + '\n\n[... truncated for token limit ...]';
}
