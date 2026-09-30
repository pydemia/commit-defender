import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type BranchReviewKind = 'changes' | 'merge-impact';

export interface BranchTarget {
  ref: string;
  name: string;
  commit: string;
  preferred: boolean;
}

export interface BranchComparison {
  kind: BranchReviewKind;
  sourceBranch: string;
  sourceCommit: string;
  targetBranch: string;
  targetCommit: string;
  baseCommit: string;
  reviewSourceCommit: string;
}

export class BranchComparisonError extends Error {
  constructor(readonly code: 'detached-head' | 'target-moved' |
    'no-changes' | 'unrelated' | 'merge-conflict' | 'git-unavailable') {
    super({
      'detached-head': 'Check out a named branch before generating a PR draft or branch review.',
      'target-moved': 'The target branch changed. Select it again before continuing.',
      'no-changes': 'This branch has no committed changes against the selected target.',
      unrelated: 'The branches do not share a merge base.',
      'merge-conflict': 'The branches conflict. Resolve the conflicts before reviewing the merged result.',
      'git-unavailable': 'Git could not prepare the branch comparison.',
    }[code]);
    this.name = 'BranchComparisonError';
  }
}

const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const execGit = promisify(execFile);
const gitEnvironment = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_OPTIONAL_LOCKS: '0',
});

async function git(
  repoRoot: string, args: string[], env?: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await execGit('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    env: env ?? gitEnvironment(),
    windowsHide: true,
  });
  return stdout.trim();
}

async function branchName(repoRoot: string): Promise<string> {
  try {
    const name = await git(repoRoot, [
      'symbolic-ref', '--quiet', '--short', 'HEAD',
    ]);
    if (name) return name;
  } catch (error) {
    if ((error as { code?: number }).code !== 1)
      throw new BranchComparisonError('git-unavailable');
  }
  throw new BranchComparisonError('detached-head');
}

async function commit(repoRoot: string, ref: string): Promise<string> {
  const value = await git(repoRoot, [
    'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`,
  ]);
  if (!oid.test(value)) throw new BranchComparisonError('git-unavailable');
  return value;
}

export async function listBranchTargets(repoRoot: string): Promise<{
  sourceBranch: string;
  targets: BranchTarget[];
}> {
  const sourceBranch = await branchName(repoRoot);
  const preferred = await (async () => {
    try {
      return await git(repoRoot, [
        'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD',
      ]);
    } catch { return ''; }
  })();
  const lines = await git(repoRoot, [
    'for-each-ref', '--format=%(refname)%09%(refname:short)%09%(objectname)',
    'refs/heads', 'refs/remotes',
  ]);
  const targets = lines.split('\n').filter(Boolean).flatMap(line => {
    const [ref, name, value] = line.split('\t');
    if (!ref || !name || !value || !oid.test(value) ||
      ref === `refs/heads/${sourceBranch}` || ref.endsWith('/HEAD')) return [];
    return [{ ref, name, commit: value, preferred: ref === preferred }];
  });
  targets.sort((a, b) => Number(b.preferred) - Number(a.preferred) ||
    a.name.localeCompare(b.name));
  return { sourceBranch, targets };
}

/** Create an unreachable merge commit; no branch, index or worktree is changed. */
export async function compareBranch(
  repoRoot: string,
  target: BranchTarget,
  kind: BranchReviewKind,
): Promise<BranchComparison> {
  const sourceBranch = await branchName(repoRoot);
  try {
    if (await commit(repoRoot, target.ref) !== target.commit)
      throw new BranchComparisonError('target-moved');
    const sourceCommit = await commit(repoRoot, 'HEAD');
    let mergeBase: string;
    try {
      mergeBase = await git(repoRoot, [
        'merge-base', sourceCommit, target.commit,
      ]);
    }
    catch { throw new BranchComparisonError('unrelated'); }
    if (!oid.test(mergeBase)) throw new BranchComparisonError('git-unavailable');
    if (sourceCommit === mergeBase)
      throw new BranchComparisonError('no-changes');
    let reviewSourceCommit = sourceCommit;
    if (kind === 'merge-impact') {
      let tree: string;
      try {
        tree = (await git(repoRoot, [
          'merge-tree', '--write-tree', target.commit, sourceCommit,
        ])).split('\n')[0];
      } catch (error) {
        if ((error as { code?: number }).code === 1)
          throw new BranchComparisonError('merge-conflict');
        throw error;
      }
      if (!oid.test(tree)) throw new BranchComparisonError('git-unavailable');
      const identity = {
        ...gitEnvironment(),
        GIT_AUTHOR_NAME: 'Commit Defender',
        GIT_AUTHOR_EMAIL: 'local@commit-defender.invalid',
        GIT_AUTHOR_DATE: '1970-01-01T00:00:00 +0000',
        GIT_COMMITTER_NAME: 'Commit Defender',
        GIT_COMMITTER_EMAIL: 'local@commit-defender.invalid',
        GIT_COMMITTER_DATE: '1970-01-01T00:00:00 +0000',
      };
      reviewSourceCommit = await git(repoRoot, [
        'commit-tree', tree, '-p', target.commit, '-p', sourceCommit,
        '-m', 'Commit Defender virtual merge',
      ], identity);
      if (!oid.test(reviewSourceCommit))
        throw new BranchComparisonError('git-unavailable');
    }
    return {
      kind, sourceBranch, sourceCommit,
      targetBranch: target.name, targetCommit: target.commit,
      baseCommit: kind === 'changes' ? mergeBase : target.commit,
      reviewSourceCommit,
    };
  } catch (error) {
    if (error instanceof BranchComparisonError) throw error;
    throw new BranchComparisonError('git-unavailable');
  }
}
