import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { isBinary, selectReviewInputs, type ExclusionObserver, type SourceSelection } from './sourcePolicy.js';

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

/** Apply the same policy to both sides of rename/copy and to index symlink modes. */
export function getStagedSelection(repoRoot: string, excludePatterns: string[] = []): SourceSelection {
  const run = (args: string[]) => execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const records = run(['diff', '--cached', '--name-status', '-z', '-M', '--diff-filter=ACMR']).split('\0');
  const changes: string[][] = [];
  for (let index = 0; index < records.length && records[index];) {
    const status = records[index++];
    const first = records[index++];
    if (!first) throw new Error('Invalid staged change record');
    const paths = [first];
    if (/^[RC]/.test(status)) {
      const second = records[index++];
      if (!second) throw new Error('Invalid staged rename record');
      paths.push(second);
    }
    changes.push(paths);
  }
  const selection = selectReviewInputs(repoRoot, changes.flat(), excludePatterns, { allowMissing: true });
  const modes = new Map<string, string>();
  for (const entry of run(['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    modes.set(entry.slice(tab + 1), entry.slice(0, 6));
  }
  const files: string[] = [];
  const excluded = [...selection.excluded];
  for (const paths of changes) {
    const target = paths[paths.length - 1];
    const rejected = paths.find(file => !selection.files.includes(file));
    if (rejected) {
      if (rejected !== target) excluded.push({ path: target, reason: selection.excluded.find(entry => entry.path === rejected)?.reason ?? 'invalid-path' });
      continue;
    }
    if (modes.get(target) === '120000') { excluded.push({ path: target, reason: 'symlink' }); continue; }
    if (modes.get(target) === '160000') { excluded.push({ path: target, reason: 'not-file' }); continue; }
    files.push(target);
  }
  return { files: [...new Set(files)], excluded };
}

export async function getStagedFiles(repoRoot: string, excludePatterns: string[] = [], onExcluded?: ExclusionObserver): Promise<string[]> {
  const selection = getStagedSelection(repoRoot, excludePatterns);
  selection.excluded.forEach(entry => onExcluded?.(entry));
  return selection.files;
}
