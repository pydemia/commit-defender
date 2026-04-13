import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExtensionConfig } from './config.js';
import { getOutputChannel } from './outputChannel.js';
import { AnalysisReport, RunResult } from './types.js';

export class DockerRunner {
  constructor(private readonly cfg: ExtensionConfig) {}

  async run(repoRoot: string, stagedFiles: string[]): Promise<RunResult> {
    const cidfile = path.join(os.tmpdir(), `commit-defender-${Date.now()}.cid`);

    try {
      return await this._run(repoRoot, stagedFiles, cidfile);
    } finally {
      fs.rmSync(cidfile, { force: true });
    }
  }

  private _run(repoRoot: string, stagedFiles: string[], cidfile: string): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const args = buildDockerArgs(repoRoot, stagedFiles, cidfile, this.cfg);
      const channel = getOutputChannel();

      channel.appendLine(`\n[Commit Defender] Running: docker ${args.join(' ')}`);

      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err: unknown) {
        const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'Docker not found. Install Docker Desktop to use Commit Defender.'
          : String(err);
        return reject(new Error(msg));
      }

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      proc.stderr?.on('data', (d: Buffer) => {
        const chunk = d.toString();
        stderr += chunk;
        channel.append(chunk); // stream ANSI output live
      });

      // Timeout: kill container gracefully via cidfile
      const timer = setTimeout(async () => {
        await killByCidfile(cidfile);
        resolve({ report: emptyReport(), stderr, timedOut: true });
      }, this.cfg.timeoutSeconds * 1000);

      proc.on('close', () => {
        clearTimeout(timer);

        if (!stdout.trim()) {
          // No JSON output — likely old image without CD_JSON support
          reject(new Error(
            'No JSON output from container. Rebuild the image:\n  docker build -t commit-defender:latest .'
          ));
          return;
        }

        let report: AnalysisReport;
        try {
          report = JSON.parse(stdout) as AnalysisReport;
        } catch {
          reject(new Error(`Failed to parse container output:\n${stdout.slice(0, 500)}`));
          return;
        }

        resolve({ report, stderr, timedOut: false });
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(new Error('Docker not found. Install Docker Desktop to use Commit Defender.'));
        } else {
          reject(err);
        }
      });
    });
  }
}

function buildDockerArgs(
  repoRoot: string,
  stagedFiles: string[],
  cidfile: string,
  cfg: ExtensionConfig
): string[] {
  const args = [
    'run', '--rm',
    '--cidfile', cidfile,
    '-v', `${repoRoot}:/repo:ro`,
    '-e', `CD_STAGED_FILES=${stagedFiles.join('\n')}`,
    '-e', 'CD_REPO_PATH=/repo',
    '-e', 'CD_JSON=1',
    cfg.image,
  ];

  // Mount home .env file if it exists (credentials)
  if (fs.existsSync(cfg.homeEnvFile)) {
    args.splice(5, 0, '-v', `${cfg.homeEnvFile}:/run/secrets/home.env:ro`);
  }

  // Mount repo-level .env file if it exists (already accessible via /repo mount,
  // but explicitly listed here for clarity — pydantic-settings reads it from /repo)
  return args;
}

async function killByCidfile(cidfile: string): Promise<void> {
  try {
    const cid = fs.readFileSync(cidfile, 'utf8').trim();
    if (cid) {
      await new Promise<void>((res) => {
        spawn('docker', ['kill', cid]).on('close', () => res());
      });
    }
  } catch {
    // cidfile may not exist if container never started
  }
}

function emptyReport(): AnalysisReport {
  return {
    schema_version: 1,
    staged_files: [],
    duration_ms: 0,
    exit_code: 1,
    lint_findings: [],
    review: { summary: 'Analysis timed out.', blocking: true, is_error: true, file_comments: [] },
  };
}
