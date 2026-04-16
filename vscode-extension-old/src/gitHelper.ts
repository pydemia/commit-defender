import { spawn } from 'child_process';

/** Returns the canonical repo root for the given directory (handles worktrees). */
export function getRepoRoot(cwd: string): Promise<string> {
  return execGit(['rev-parse', '--show-toplevel'], cwd);
}

/** Returns repo-relative paths of staged files (Added/Copied/Modified/Renamed). */
export async function getStagedFiles(repoRoot: string): Promise<string[]> {
  const output = await execGit(
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    repoRoot
  );
  return output.split('\n').filter(Boolean);
}

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`git ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`));
      }
    });
    proc.on('error', reject);
  });
}
