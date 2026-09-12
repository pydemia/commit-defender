import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { normalizedSourcePath, selectReviewInputs, type SourceSelection } from './sourcePolicy.js';

interface TreeEntry { mode: string; type: string; oid: string }
interface Change { status: string; paths: string[] }
type Tree = Map<string, TreeEntry>;

function run(repoRoot: string, args: string[], input?: string | Buffer, indexFile?: string): string {
  return execFileSync('git', [
    '--no-replace-objects', '--literal-pathspecs', '-C', repoRoot,
    '-c', 'core.fsmonitor=false', ...args,
  ], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], input,
    env: {
      ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1',
      GIT_GLOB_PATHSPECS: '0', GIT_NOGLOB_PATHSPECS: '0', GIT_ICASE_PATHSPECS: '0',
      ...(indexFile ? { GIT_INDEX_FILE: indexFile } : {}),
    },
  });
}

function withTemporaryIndex<T>(fn: (index: string) => T): T {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-index-'));
  try { return fn(path.join(directory, 'index')); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function captureIndexTree(repoRoot: string): string {
  const indexPath = path.resolve(repoRoot, run(repoRoot, ['rev-parse', '--git-path', 'index']).trim());
  return withTemporaryIndex(index => {
    try {
      // Git replaces the index atomically. Copy its bytes, including intent-to-add flags,
      // before write-tree can refresh an index cache or acquire an index lock.
      fs.writeFileSync(index, fs.readFileSync(indexPath), { mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      run(repoRoot, ['read-tree', '--empty'], undefined, index);
    }
    return run(repoRoot, ['write-tree'], undefined, index).trim();
  });
}

function readTree(repoRoot: string, tree: string): Tree {
  const entries: Tree = new Map();
  for (const record of run(repoRoot, ['ls-tree', '-r', '-z', tree]).split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    if (tab < 0 || !/^[0-9a-f]{40,64}$/.test(oid)) throw new Error('Invalid Git tree entry');
    entries.set(record.slice(tab + 1), { mode, type, oid });
  }
  return entries;
}

function parseChanges(records: string): Change[] {
  const tokens = records.split('\0');
  const changes: Change[] = [];
  for (let index = 0; index < tokens.length && tokens[index];) {
    const status = tokens[index++];
    const paths = [tokens[index++]];
    if (/^[RC]/.test(status)) paths.push(tokens[index++]);
    if (paths.some(file => !file)) throw new Error('Invalid Git change record');
    changes.push({ status, paths });
  }
  return changes;
}

/** Build a tree containing only exact allowed entries. A literal Git pathspec still
 * matches descendants when a file has become a directory; pruning prevents that leak. */
function selectedTree(repoRoot: string, tree: Tree, paths: Set<string>): string {
  return withTemporaryIndex(index => {
    run(repoRoot, ['read-tree', '--empty'], undefined, index);
    const entries = [...paths].flatMap(file => {
      const entry = tree.get(file);
      return entry ? [`${entry.mode} ${entry.oid}\t${file}\0`] : [];
    }).join('');
    if (entries) run(repoRoot, ['update-index', '-z', '--index-info'], entries, index);
    return run(repoRoot, ['write-tree'], undefined, index).trim();
  });
}

export interface StagedSnapshot extends SourceSelection {
  baseCommit: string | null;
  baseTree: string;
  sourceTree: string;
  sideOf(file: string): 'source' | 'base';
  /** Fixed base for deleted paths, fixed index for other selected paths. */
  readSelected(file: string): string;
  /** Related source remains available from the same tree without a working-tree fallback. */
  readSource(file: string, side?: 'base' | 'source'): string | undefined;
  diff(files?: string[]): string;
}

export function captureStagedSnapshot(repoRoot: string, patterns: string[] = []): StagedSnapshot {
  let baseCommit: string | null;
  try { baseCommit = run(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']).trim(); }
  catch (error) {
    if ((error as { status?: number }).status !== 1) throw error;
    // An absent branch is an initial commit; corrupt or detached HEAD is not.
    run(repoRoot, ['symbolic-ref', '--quiet', 'HEAD']);
    baseCommit = null;
  }
  const baseTree = baseCommit
    ? run(repoRoot, ['rev-parse', '--verify', `${baseCommit}^{tree}`]).trim()
    : run(repoRoot, ['hash-object', '-w', '-t', 'tree', '--stdin'], '').trim();
  const sourceTree = captureIndexTree(repoRoot);
  const base = readTree(repoRoot, baseTree);
  const source = readTree(repoRoot, sourceTree);
  const changes = parseChanges(run(repoRoot, [
    'diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', baseTree, sourceTree,
  ]));
  const selection = selectReviewInputs(repoRoot, changes.flatMap(change => change.paths), patterns, { gitTree: true });
  const allowed = new Set(selection.files);
  const excluded = [...selection.excluded];
  for (const file of selection.files) {
    for (const tree of [base, source]) {
      const entry = tree.get(file);
      if (!entry || (entry.type === 'blob' && ['100644', '100755'].includes(entry.mode))) continue;
      allowed.delete(file);
      excluded.push({ path: file, reason: entry.mode === '120000' ? 'symlink' : 'not-file' });
      break;
    }
  }
  const selected = new Map<string, Change>();
  for (const change of changes) {
    const file = change.paths[change.paths.length - 1];
    const denied = change.paths.find(name => !allowed.has(name));
    if (denied) {
      if (denied !== file) excluded.push({ path: file, reason: excluded.find(entry => entry.path === denied)?.reason ?? 'invalid-path' });
    } else { selected.set(file, change); }
  }
  const read = (file: string, tree: Tree): string | undefined => {
    if (!normalizedSourcePath(file)) throw new Error('Invalid snapshot source path');
    const entry = tree.get(file);
    if (!entry) return undefined;
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)
        || !selectReviewInputs(repoRoot, [file], patterns, { gitTree: true }).files.length) {
      throw new Error(`Source excluded from Git snapshot: ${file}`);
    }
    const text = run(repoRoot, ['cat-file', 'blob', entry.oid]);
    if (text.includes('\0')) throw new Error(`Binary source cannot be reviewed as text: ${file}`);
    return text;
  };
  return {
    files: [...selected.keys()], excluded, baseCommit, baseTree, sourceTree,
    sideOf: file => selected.get(file)?.status === 'D' ? 'base' : 'source',
    readSource: (file, side = 'source') => read(file, side === 'base' ? base : source),
    readSelected(file) {
      const change = selected.get(file);
      if (!change) throw new Error(`File is not selected in Git snapshot: ${file}`);
      const text = read(file, change.status === 'D' ? base : source);
      if (text === undefined) throw new Error(`Snapshot source is missing: ${file}`);
      return text;
    },
    diff(files = [...selected.keys()]) {
      const paths = new Set(files.flatMap(file => selected.get(file)?.paths ?? []));
      if (!paths.size) return '';
      // Neither tree contains excluded entries, including excluded children of a former file.
      const left = selectedTree(repoRoot, base, paths);
      const right = selectedTree(repoRoot, source, paths);
      return run(repoRoot, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '-M', left, right]);
    },
  };
}

/** Read an exact immutable entry; never interpret a report path as a Git expression. */
export function readGitTreeFile(repoRoot: string, tree: string, file: string): string | undefined {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(tree) || !normalizedSourcePath(file)) return undefined;
  if (!selectReviewInputs(repoRoot, [file], [], { gitTree: true }).files.length) return undefined;
  const entry = readTree(repoRoot, tree).get(file);
  if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) return undefined;
  const content = run(repoRoot, ['cat-file', 'blob', entry.oid]);
  return content.includes('\0') ? undefined : content;
}
