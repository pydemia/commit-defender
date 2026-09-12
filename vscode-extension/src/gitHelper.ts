import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { isBinary, selectReviewInputs, type ExclusionObserver, type SourceSelection } from './sourcePolicy.js';
import { captureStagedSnapshot } from './gitSnapshot.js';

export { isBinary, SKIP_DIRS } from './sourcePolicy.js';

/** Extension-only filtering is not a source authorization check. */
export function filterForAnalysis(files: string[]): string[] {
  return files.filter(file => !isBinary(file));
}

/** Enumerate metadata and prune excluded directories before reading their contents. */
export function collectFiles(
  dirPath: string, repoRoot: string, excludePatterns: string[] = [], onExcluded?: ExclusionObserver,
): string[] {
  const results: string[] = [];
  const relative = (file: string) => path.relative(path.resolve(repoRoot), path.resolve(file)).split(path.sep).join('/');
  function walk(dir: string): void {
    const rel = relative(dir);
    if (rel) {
      const selection = selectReviewInputs(repoRoot, [rel], excludePatterns, { allowDirectories: true });
      selection.excluded.forEach(entry => onExcluded?.(entry));
      if (!selection.files.length) return;
    }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { onExcluded?.({ path: rel || '.', reason: 'unreadable' }); return; }
    const selection = selectReviewInputs(repoRoot, entries.map(entry => relative(path.join(dir, entry.name))), excludePatterns, { allowDirectories: true });
    selection.excluded.forEach(entry => onExcluded?.(entry));
    const allowed = new Set(selection.files);
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const file = relative(absolute);
      if (!allowed.has(file)) continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) results.push(file);
    }
  }
  walk(path.resolve(dirPath));
  return results.sort();
}

export async function getRepoRoot(cwd: string): Promise<string> {
  return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Select from the same fixed index/base pair used by staged review. */
export function getStagedSelection(repoRoot: string, excludePatterns: string[] = []): SourceSelection {
  const { files, excluded } = captureStagedSnapshot(repoRoot, excludePatterns);
  return { files, excluded };
}

export async function getStagedFiles(repoRoot: string, excludePatterns: string[] = [], onExcluded?: ExclusionObserver): Promise<string[]> {
  const selection = getStagedSelection(repoRoot, excludePatterns);
  selection.excluded.forEach(entry => onExcluded?.(entry));
  return selection.files;
}
