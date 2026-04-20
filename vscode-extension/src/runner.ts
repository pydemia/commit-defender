import { spawn } from 'child_process';
import { ExtensionConfig } from './config.js';
import { getOutputChannel } from './outputChannel.js';
import { AnalysisReport, RunResult } from './types.js';

export class PythonRunner {
  private _proc: ReturnType<typeof spawn> | null = null;
  private _cancelled = false;

  constructor(
    private readonly cfg: ExtensionConfig,
    private readonly onProgress?: (current: number, total: number, file: string) => void,
  ) {}

  /** Kill the currently running subprocess, if any. */
  cancel(): void {
    if (this._proc) {
      this._cancelled = true;
      this._proc.kill('SIGKILL');
      this._proc = null;
    }
  }

  /** Analyze staged files. Uses full file content mode (not git-diff mode). */
  run(repoRoot: string, stagedFiles: string[], timeoutSeconds: number): Promise<RunResult> {
    return this._spawn(repoRoot, { CD_TARGET_FILES: stagedFiles.join('\n') }, timeoutSeconds);
  }

  /** Analyze an explicit list of repo-relative file paths (on-demand mode). */
  runTargets(repoRoot: string, relPaths: string[], timeoutSeconds: number): Promise<RunResult> {
    return this._spawn(repoRoot, { CD_TARGET_FILES: relPaths.join('\n') }, timeoutSeconds);
  }

  private _spawn(repoRoot: string, extraEnv: NodeJS.ProcessEnv, timeoutSeconds: number): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const channel = getOutputChannel();

      const args = ['-m', 'commit_defender.entrypoint'];
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CD_REPO_PATH: repoRoot,
        CD_JSON: '1',
        // Empty string = "not set by VS Code" → Python falls back to settings.json
        ...(this.cfg.analysisMode  && { CD_ANALYSIS_MODE:  this.cfg.analysisMode }),
        ...(this.cfg.severityLevel && { CD_SEVERITY_LEVEL: this.cfg.severityLevel }),
        ...(this.cfg.richnessLevel && { CD_RICHNESS_LEVEL: this.cfg.richnessLevel }),
        ...(this.cfg.locale        && { CD_LOCALE:         this.cfg.locale }),
        // Newline-separated gitignore patterns
        ...(this.cfg.excludePatterns.length > 0 && {
          CD_EXCLUDE_PATTERNS: this.cfg.excludePatterns.join('\n'),
        }),
        CD_STAGED_FILES_WARN_THRESHOLD:  String(this.cfg.stagedFilesWarnThreshold),
        CD_REPO_ANALYSIS_WARN_THRESHOLD: String(this.cfg.repoAnalysisWarnThreshold),
        // AI connection settings — forwarded from VS Code settings.
        CD_AI_PROVIDER:  this.cfg.aiProvider,
        CD_MAX_TOKENS:   String(this.cfg.maxTokens),
        ...(this.cfg.model      && { CD_MODEL:       this.cfg.model }),
        ...(this.cfg.endpoint   && { CD_ENDPOINT:    this.cfg.endpoint }),
        ...(this.cfg.apiVersion && { CD_API_VERSION: this.cfg.apiVersion }),
        ...(this.cfg.apiKey     && { CD_API_KEY:     this.cfg.apiKey }),
        ...extraEnv,
      };

      // Log exactly what we're sending so the output channel shows the full picture
      const targetFiles = extraEnv['CD_TARGET_FILES'];
      const stagedFiles = extraEnv['CD_STAGED_FILES'];
      if (targetFiles !== undefined) {
        const count = targetFiles ? targetFiles.split('\n').filter(Boolean).length : 0;
        channel.appendLine(`\n[Commit Defender] Analyzing ${count} file(s) (on-demand):`);
        if (targetFiles) { targetFiles.split('\n').filter(Boolean).forEach(f => channel.appendLine(`  ${f}`)); }
      } else if (stagedFiles !== undefined) {
        const count = stagedFiles ? stagedFiles.split('\n').filter(Boolean).length : 0;
        channel.appendLine(`\n[Commit Defender] Analyzing ${count} staged file(s).`);
      }
      channel.appendLine(`[Commit Defender] Repo: ${repoRoot}`);
      channel.appendLine(`[Commit Defender] Python: ${this.cfg.pythonExecutable}`);
      channel.appendLine(`[Commit Defender] Settings:`);
      channel.appendLine(`  provider    : ${env['CD_AI_PROVIDER'] ?? '(not set)'}`);
      channel.appendLine(`  model       : ${env['CD_MODEL']       ?? '(not set)'}`);
      channel.appendLine(`  endpoint    : ${env['CD_ENDPOINT']    ?? '(not set)'}`);
      channel.appendLine(`  api_version : ${env['CD_API_VERSION'] ?? '(not set)'}`);
      channel.appendLine(`  api_key     : ${env['CD_API_KEY'] ? `(set, ${env['CD_API_KEY'].length} chars)` : '(NOT SET)'}`);
      channel.appendLine(`  mode        : ${env['CD_ANALYSIS_MODE'] ?? '(not set — default: hybrid)'}`);

      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(this.cfg.pythonExecutable, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: repoRoot,
          env: env
        });
        this._proc = proc;
      } catch (err: unknown) {
        const msg = `Failed to spawn Python process: ${String(err)}`;
        channel.appendLine(`[Error] ${msg}`);
        return reject(new Error(msg));
      }

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      proc.stderr?.on('data', (d: Buffer) => {
        const chunk = d.toString();
        stderr += chunk;
        channel.append(chunk);
        // Parse "[commit-defender] AI review N/M: filename" progress lines
        if (this.onProgress) {
          const m = chunk.match(/\[commit-defender\] AI review (\d+)\/(\d+): (.+)/);
          if (m) {
            this.onProgress(parseInt(m[1]), parseInt(m[2]), m[3].trim());
          }
        }
      });

      // Timeout: kill process gracefully. 0 = no limit.
      const timer = timeoutSeconds > 0
        ? setTimeout(() => {
            proc.kill('SIGKILL');
            channel.appendLine(`[Error] Analysis timed out after ${timeoutSeconds}s — process killed.`);
            resolve({ report: emptyReport(), stderr, timedOut: true, cancelled: false });
          }, timeoutSeconds * 1000)
        : null;

      proc.on('close', async (code) => {
        this._proc = null;
        if (timer !== null) { clearTimeout(timer); }

        if (this._cancelled) {
          channel.appendLine('[Commit Defender] Analysis cancelled by user.');
          resolve({ report: emptyReport(), stderr, timedOut: false, cancelled: true });
          return;
        }

        channel.appendLine(`[Commit Defender] Process exited with code ${code}`);

        if (!stdout.trim()) {
          if (code === 0) {
            // Exit 0 with no stdout AND no stderr means the package is missing or
            // outdated. Run a quick import diagnostic so the user knows what to fix.
            if (!stderr.trim()) {
              channel.appendLine('[Commit Defender] Python produced no output at all.');
              channel.appendLine('[Commit Defender] Running import diagnostic…');
              const diag = await importDiagnostic(this.cfg.pythonExecutable, repoRoot);
              channel.appendLine(diag);
              channel.appendLine('');
              channel.appendLine('Quick fixes to try:');
              channel.appendLine(`  1. ${this.cfg.pythonExecutable} -m pip install --upgrade commit-defender`);
              channel.appendLine(`  2. Or install from source: ${this.cfg.pythonExecutable} -m pip install -e /path/to/commit-defender`);
              channel.appendLine(`  3. Check commitDefender.pythonExecutable points to the right Python`);
              channel.show(true);
            } else {
              // Has stderr (Python skip/exclude messages) but no JSON → no files matched
              channel.appendLine('[Commit Defender] No JSON on stdout — all files were filtered or skipped. See stderr above.');
            }
            resolve({ report: noFilesReport(), stderr, timedOut: false, cancelled: false });
            return;
          }
          // Non-zero exit with no JSON — real failure
          const tail = stderr.trim().slice(-1200);
          const hint = tail
            ? `\n\nPython output:\n${tail}`
            : `\n\n(no output) Make sure the package is installed:\n  ${this.cfg.pythonExecutable} -m pip install commit-defender`;
          const msg = `commit-defender failed (exit code ${code}).` + hint;
          channel.appendLine(`[Error] ${msg}`);
          reject(new Error(msg));
          return;
        }

        let report: AnalysisReport;
        try {
          report = JSON.parse(stdout) as AnalysisReport;
        } catch {
          const msg = `Failed to parse JSON output (exit code ${code}):\n${stdout.slice(0, 500)}`;
          channel.appendLine(`[Error] ${msg}`);
          reject(new Error(msg));
          return;
        }

        resolve({ report, stderr, timedOut: false, cancelled: false });
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        this._proc = null;
        if (timer !== null) { clearTimeout(timer); }
        const msg = err.code === 'ENOENT'
          ? `Python not found: '${this.cfg.pythonExecutable}'. Set commitDefender.pythonExecutable in settings.`
          : `Process error: ${err.message}`;
        channel.appendLine(`[Error] ${msg}`);
        reject(new Error(msg));
      });
    });
  }
}

/**
 * Run a quick Python import check and return a diagnostic string.
 * Called when the main process exits 0 with no output at all.
 */
function importDiagnostic(pythonExecutable: string, cwd: string): Promise<string> {
  return new Promise(resolve => {
    const script = [
      'import sys',
      'try:',
      '    import commit_defender',
      '    v = getattr(commit_defender, "__version__", "unknown")',
      '    import commit_defender.entrypoint',
      '    print(f"[diag] commit_defender {v} is installed and importable")',
      '    print(f"[diag] package location: {commit_defender.__file__}")',
      'except ImportError as e:',
      '    print(f"[diag] ImportError: {e}", file=sys.stderr)',
      '    sys.exit(1)',
    ].join('\n');

    const proc = spawn(pythonExecutable, ['-c', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
    });

    let out = '';
    let err = '';
    proc.stdout?.on('data', (d: Buffer) => (out += d.toString()));
    proc.stderr?.on('data', (d: Buffer) => (err += d.toString()));

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(out.trim());
      } else {
        resolve(
          `[diag] commit_defender is NOT installed in ${pythonExecutable}\n` +
          `[diag] Error: ${err.trim() || '(no details)'}`
        );
      }
    });

    proc.on('error', (e) => {
      resolve(`[diag] Cannot run Python (${pythonExecutable}): ${e.message}`);
    });

    setTimeout(() => {
      proc.kill();
      resolve('[diag] Import check timed out');
    }, 10_000);
  });
}

function emptyReport(): AnalysisReport {
  return {
    schema_version: 1,
    staged_files: [],
    duration_ms: 0,
    exit_code: 1,
    lint_findings: [],
    review: { summary: 'Analysis timed out.', blocking: true, is_error: true, file_comments: [], grade: '' },
  };
}

function noFilesReport(): AnalysisReport {
  return {
    schema_version: 1,
    staged_files: [],
    duration_ms: 0,
    exit_code: 0,
    lint_findings: [],
    review: { summary: 'No files matched for analysis. Check the output panel for details.', blocking: false, is_error: false, file_comments: [], grade: '' },
  };
}
