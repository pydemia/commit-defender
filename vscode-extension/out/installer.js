"use strict";
/**
 * Auto-installer for the commit_defender Python backend.
 *
 * On every activation the extension checks whether the package is importable
 * and whether its version matches the extension version.  If the package is
 * missing or out-of-date it installs / upgrades it silently in the background,
 * showing a progress notification so the user knows what is happening.
 *
 * The last-installed version is persisted in globalState keyed by the Python
 * executable path so that each venv is tracked independently.
 */
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
exports.ensurePackageInstalled = ensurePackageInstalled;
exports.ensurePreCommitHook = ensurePreCommitHook;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
const outputChannel_js_1 = require("./outputChannel.js");
const PYPI_PACKAGE = 'commit-defender';
/**
 * Ensure the Python backend is installed and matches `expectedVersion`.
 * Silently returns if everything is already in order.
 */
async function ensurePackageInstalled(pythonExecutable, expectedVersion, context) {
    const stateKey = `pkgVersion:${pythonExecutable}`;
    const cachedVersion = context.globalState.get(stateKey);
    // Fast path: we already installed this exact version for this Python binary.
    // Still run a quick import check in case the venv was recreated.
    if (cachedVersion === expectedVersion) {
        const ok = await isImportable(pythonExecutable);
        if (ok) {
            return;
        }
    }
    // Slow path: package is missing or version changed — install / upgrade.
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Commit Defender: installing Python backend (${PYPI_PACKAGE} v${expectedVersion})…`,
        cancellable: false,
    }, async () => {
        const channel = (0, outputChannel_js_1.getOutputChannel)();
        channel.appendLine(`\n[Commit Defender] Installing ${PYPI_PACKAGE}==${expectedVersion} ` +
            `into ${pythonExecutable} …`);
        const installed = await pipInstall(pythonExecutable, expectedVersion, channel);
        if (installed) {
            await context.globalState.update(stateKey, expectedVersion);
            channel.appendLine(`[Commit Defender] Python backend installed successfully.`);
        }
        else {
            // Installation failed — warn and let the user run manually.
            channel.appendLine(`[Commit Defender] Auto-install failed.  ` +
                `Run manually:\n  ${pythonExecutable} -m pip install ${PYPI_PACKAGE}`);
            channel.show(true);
            vscode.window.showWarningMessage(`Commit Defender: could not install Python backend automatically.`, 'Show Output').then(action => { if (action === 'Show Output') {
                channel.show();
            } });
        }
    });
}
// ── Pre-commit hook management ────────────────────────────────────────────────
const HOOK_SIGNATURE = 'commit-defender';
/**
 * Ensure the git pre-commit hook is installed in `repoRoot`.
 * Does nothing if the hook already contains the commit-defender signature.
 * Silently skips if `repoRoot` has no `.git` directory.
 */
async function ensurePreCommitHook(pythonExecutable, repoRoot) {
    const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-commit');
    // Already installed?
    try {
        const content = fs.readFileSync(hookPath, 'utf8');
        if (content.includes(HOOK_SIGNATURE)) {
            return;
        }
    }
    catch {
        // File doesn't exist — proceed to install
    }
    const channel = (0, outputChannel_js_1.getOutputChannel)();
    channel.appendLine(`\n[Commit Defender] Installing pre-commit hook in ${repoRoot} …`);
    const ok = await runInstall(pythonExecutable, repoRoot, channel);
    if (ok) {
        channel.appendLine('[Commit Defender] Pre-commit hook installed.');
        vscode.window.showInformationMessage('Commit Defender: Pre-commit hook installed. Commits in this repo will now be reviewed automatically.');
    }
    else {
        channel.appendLine('[Commit Defender] Pre-commit hook installation failed. Run manually: commit-defender install .');
        vscode.window.showWarningMessage('Commit Defender: Could not install pre-commit hook automatically.', 'Show Output').then(action => { if (action === 'Show Output') {
            channel.show();
        } });
    }
}
/** Run `python -m commit_defender.entrypoint install <repoRoot> --force`. */
function runInstall(python, repoRoot, channel) {
    return new Promise(resolve => {
        let proc;
        try {
            proc = (0, child_process_1.spawn)(python, ['-m', 'commit_defender.entrypoint', 'install', repoRoot, '--force'], {
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        }
        catch {
            resolve(false);
            return;
        }
        proc.stdout?.on('data', (d) => channel.append(d.toString()));
        proc.stderr?.on('data', (d) => channel.append(d.toString()));
        proc.on('close', code => resolve(code === 0));
        proc.on('error', () => resolve(false));
    });
}
// ── Helpers ───────────────────────────────────────────────────────────────────
/** Returns true if `commit_defender` can be imported by this Python binary. */
function isImportable(python) {
    return new Promise(resolve => {
        const proc = (0, child_process_1.spawn)(python, ['-c', 'import commit_defender'], { stdio: 'ignore' });
        proc.on('close', code => resolve(code === 0));
        proc.on('error', () => resolve(false));
    });
}
/**
 * Run `python -m pip install commit-defender==<version>`.
 * Falls back to `pip install commit-defender` (latest) if the exact version
 * is not yet on PyPI.
 * Returns true on success, false on failure.
 */
async function pipInstall(python, version, channel) {
    // First try the pinned version.
    const pinned = await runPip(python, [`${PYPI_PACKAGE}==${version}`], channel);
    if (pinned) {
        return true;
    }
    // Pinned version may not be on PyPI yet — fall back to latest.
    channel.appendLine(`[Commit Defender] Pinned version not found; installing latest ${PYPI_PACKAGE}…`);
    return runPip(python, [PYPI_PACKAGE], channel);
}
/** Runs `python -m pip install <packages>` and streams output to the channel. */
function runPip(python, packages, channel) {
    return new Promise(resolve => {
        let proc;
        try {
            proc = (0, child_process_1.spawn)(python, ['-m', 'pip', 'install', ...packages], {
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        }
        catch {
            resolve(false);
            return;
        }
        proc.stdout?.on('data', (d) => channel.append(d.toString()));
        proc.stderr?.on('data', (d) => channel.append(d.toString()));
        proc.on('close', code => resolve(code === 0));
        proc.on('error', () => resolve(false));
    });
}
//# sourceMappingURL=installer.js.map