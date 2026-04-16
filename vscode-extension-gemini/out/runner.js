"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PythonRunner = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const outputChannel_js_1 = require("./outputChannel.js");
class PythonRunner {
    cfg;
    onProgress;
    constructor(cfg, onProgress) {
        this.cfg = cfg;
        this.onProgress = onProgress;
    }
    /** Analyze staged files. Uses full file content mode (not git-diff mode). */
    run(repoRoot, stagedFiles) {
        // Pass as CD_TARGET_FILES so Python uses full file content — not just the
        // staged diff — giving the AI complete context for each file.
        return this._spawn(repoRoot, { CD_TARGET_FILES: stagedFiles.join('\n') });
    }
    /** Analyze an explicit list of repo-relative file paths (on-demand mode). */
    runTargets(repoRoot, relPaths) {
        return this._spawn(repoRoot, { CD_TARGET_FILES: relPaths.join('\n') });
    }
    _spawn(repoRoot, extraEnv) {
        return new Promise((resolve, reject) => {
            const channel = (0, outputChannel_js_1.getOutputChannel)();
            const args = ['-m', 'commit_defender.entrypoint'];
            const env = {
                ...process.env,
                CD_REPO_PATH: repoRoot,
                CD_JSON: '1',
                // Empty string = "not set by VS Code" → Python falls back to settings.json
                ...(this.cfg.analysisMode && { CD_ANALYSIS_MODE: this.cfg.analysisMode }),
                ...(this.cfg.severityLevel && { CD_SEVERITY_LEVEL: this.cfg.severityLevel }),
                ...(this.cfg.richnessLevel && { CD_RICHNESS_LEVEL: this.cfg.richnessLevel }),
                ...(this.cfg.locale && { CD_LOCALE: this.cfg.locale }),
                // Newline-separated gitignore patterns — merged with .commit-defender/settings.json
                ...(this.cfg.excludePatterns.length > 0 && {
                    CD_EXCLUDE_PATTERNS: this.cfg.excludePatterns.join('\n'),
                }),
                // AI connection settings — forwarded from VS Code settings.
                // Empty strings are ignored by Python (falls back to ~/.commit-defender.env).
                CD_AI_PROVIDER: this.cfg.aiProvider,
                CD_MAX_TOKENS: String(this.cfg.maxTokens),
                ...(this.cfg.model && { CD_MODEL: this.cfg.model }),
                ...(this.cfg.endpoint && { CD_ENDPOINT: this.cfg.endpoint }),
                ...(this.cfg.apiVersion && { CD_API_VERSION: this.cfg.apiVersion }),
                ...(this.cfg.apiKey && { CD_API_KEY: this.cfg.apiKey }),
                ...extraEnv,
            };
            // Pass a custom home env file path when the user has configured one that
            // differs from the default ~/.commit-defender.env.  commit_defender's
            // pydantic-settings reads CD_HOME_ENV_FILE and uses it as the home env source.
            if (this.cfg.homeEnvFile && fs.existsSync(this.cfg.homeEnvFile)) {
                env['CD_HOME_ENV_FILE'] = this.cfg.homeEnvFile;
            }
            // Log exactly what we're sending so the output channel shows the full picture
            const targetFiles = extraEnv['CD_TARGET_FILES'];
            const stagedFiles = extraEnv['CD_STAGED_FILES'];
            if (targetFiles !== undefined) {
                const count = targetFiles ? targetFiles.split('\n').filter(Boolean).length : 0;
                channel.appendLine(`\n[Commit Defender] Analyzing ${count} file(s) (on-demand):`);
                if (targetFiles) {
                    targetFiles.split('\n').filter(Boolean).forEach(f => channel.appendLine(`  ${f}`));
                }
            }
            else if (stagedFiles !== undefined) {
                const count = stagedFiles ? stagedFiles.split('\n').filter(Boolean).length : 0;
                channel.appendLine(`\n[Commit Defender] Analyzing ${count} staged file(s).`);
            }
            channel.appendLine(`[Commit Defender] Repo: ${repoRoot}`);
            channel.appendLine(`[Commit Defender] Python: ${this.cfg.pythonExecutable}`);
            let proc;
            try {
                proc = (0, child_process_1.spawn)(this.cfg.pythonExecutable, args, {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    cwd: repoRoot,
                    env: env
                });
            }
            catch (err) {
                const msg = `Failed to spawn Python process: ${String(err)}`;
                channel.appendLine(`[Error] ${msg}`);
                return reject(new Error(msg));
            }
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (d) => (stdout += d.toString()));
            proc.stderr?.on('data', (d) => {
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
            // Timeout: kill process gracefully
            const timer = setTimeout(() => {
                proc.kill('SIGKILL');
                channel.appendLine('[Error] Analysis timed out — process killed.');
                resolve({ report: emptyReport(), stderr, timedOut: true });
            }, this.cfg.timeoutSeconds * 1000);
            proc.on('close', async (code) => {
                clearTimeout(timer);
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
                        }
                        else {
                            // Has stderr (Python skip/exclude messages) but no JSON → no files matched
                            channel.appendLine('[Commit Defender] No JSON on stdout — all files were filtered or skipped. See stderr above.');
                        }
                        resolve({ report: noFilesReport(), stderr, timedOut: false });
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
                let report;
                try {
                    report = JSON.parse(stdout);
                }
                catch {
                    const msg = `Failed to parse JSON output (exit code ${code}):\n${stdout.slice(0, 500)}`;
                    channel.appendLine(`[Error] ${msg}`);
                    reject(new Error(msg));
                    return;
                }
                resolve({ report, stderr, timedOut: false });
            });
            proc.on('error', (err) => {
                clearTimeout(timer);
                const msg = err.code === 'ENOENT'
                    ? `Python not found: '${this.cfg.pythonExecutable}'. Set commitDefender.pythonExecutable in settings.`
                    : `Process error: ${err.message}`;
                channel.appendLine(`[Error] ${msg}`);
                reject(new Error(msg));
            });
        });
    }
}
exports.PythonRunner = PythonRunner;
/**
 * Run a quick Python import check and return a diagnostic string.
 * Called when the main process exits 0 with no output at all.
 */
function importDiagnostic(pythonExecutable, cwd) {
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
        const proc = (0, child_process_1.spawn)(pythonExecutable, ['-c', script], {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd,
        });
        let out = '';
        let err = '';
        proc.stdout?.on('data', (d) => (out += d.toString()));
        proc.stderr?.on('data', (d) => (err += d.toString()));
        proc.on('close', (code) => {
            if (code === 0) {
                resolve(out.trim());
            }
            else {
                resolve(`[diag] commit_defender is NOT installed in ${pythonExecutable}\n` +
                    `[diag] Error: ${err.trim() || '(no details)'}`);
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
function emptyReport() {
    return {
        schema_version: 1,
        staged_files: [],
        duration_ms: 0,
        exit_code: 1,
        lint_findings: [],
        review: { summary: 'Analysis timed out.', blocking: true, is_error: true, file_comments: [], grade: '' },
    };
}
function noFilesReport() {
    return {
        schema_version: 1,
        staged_files: [],
        duration_ms: 0,
        exit_code: 0,
        lint_findings: [],
        review: { summary: 'No files matched for analysis. Check the output panel for details.', blocking: false, is_error: false, file_comments: [], grade: '' },
    };
}
//# sourceMappingURL=runner.js.map