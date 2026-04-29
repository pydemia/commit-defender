"use strict";
/**
 * Pre-commit hook installation and config materialisation.
 *
 * The hook is a tiny shell wrapper that exec's the bundled Node CLI:
 *   node <ext-out>/hook-cli.js <repoRoot>
 *
 * VS Code settings are mirrored into <repoRoot>/.commit-defender/hook.json so
 * that the hook works at `git commit` time even when VS Code isn't running.
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
exports.configToHookJson = configToHookJson;
exports.writeHookConfig = writeHookConfig;
exports.installHook = installHook;
exports.uninstallHook = uninstallHook;
exports.hookIsInstalled = hookIsInstalled;
exports.hookConfigPath = hookConfigPath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const outputChannel_js_1 = require("../outputChannel.js");
const HOOK_SIGNATURE = '# commit-defender hook v2';
const CONFIG_DIR = '.commit-defender';
const CONFIG_FILE = 'hook.json';
const GITIGNORE_LINE = `${CONFIG_DIR}/${CONFIG_FILE}`;
function configToHookJson(cfg) {
    return {
        aiProvider: cfg.aiProvider,
        model: cfg.model,
        endpoint: cfg.endpoint,
        apiVersion: cfg.apiVersion,
        apiKey: cfg.apiKey,
        maxTokens: cfg.maxTokens,
        severityLevel: cfg.severityLevel,
        richnessLevel: cfg.richnessLevel,
        locale: cfg.locale,
        excludePatterns: cfg.excludePatterns,
    };
}
/**
 * Write VS Code settings into <repo>/.commit-defender/hook.json. Idempotent —
 * always overwrites with the current snapshot. Adds the file to .gitignore if
 * it isn't already ignored.
 */
function writeHookConfig(repoRoot, cfg) {
    const dir = path.join(repoRoot, CONFIG_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, CONFIG_FILE);
    fs.writeFileSync(file, JSON.stringify(configToHookJson(cfg), null, 2) + '\n', { mode: 0o600 });
    ensureGitignored(repoRoot);
}
function ensureGitignored(repoRoot) {
    const gi = path.join(repoRoot, '.gitignore');
    let text = '';
    try {
        text = fs.readFileSync(gi, 'utf8');
    }
    catch { /* missing — will create */ }
    if (text.split(/\r?\n/).some(line => line.trim() === GITIGNORE_LINE)) {
        return;
    }
    const sep = text.length === 0 || text.endsWith('\n') ? '' : '\n';
    fs.writeFileSync(gi, `${text}${sep}# commit-defender (contains API key)\n${GITIGNORE_LINE}\n`);
}
/** Build the shell script body that invokes the bundled hook CLI. */
function buildHookScript(extensionPath) {
    const cliPath = path.join(extensionPath, 'out', 'hook-cli.js');
    // POSIX shell. `command -v node` keeps the hook portable across nvm/asdf shims.
    return [
        '#!/usr/bin/env sh',
        HOOK_SIGNATURE,
        '# Installed by the Commit Defender VS Code extension.',
        '# To bypass (not recommended): git commit --no-verify',
        '',
        'set -e',
        '',
        'REPO_ROOT="$(git rev-parse --show-toplevel)"',
        '',
        'if ! command -v node >/dev/null 2>&1; then',
        '    echo "commit-defender: node not found in PATH — skipping pre-commit review." >&2',
        '    exit 0',
        'fi',
        '',
        `exec node ${shellQuote(cliPath)} "$REPO_ROOT"`,
        '',
    ].join('\n');
}
function shellQuote(s) {
    // Single-quote and escape any embedded single quotes by closing/reopening.
    return `'${s.replace(/'/g, `'\\''`)}'`;
}
async function installHook(repoRoot, extensionPath, cfg) {
    const channel = (0, outputChannel_js_1.getOutputChannel)();
    const hookDir = path.join(repoRoot, '.git', 'hooks');
    const hookPath = path.join(hookDir, 'pre-commit');
    try {
        fs.mkdirSync(hookDir, { recursive: true });
    }
    catch (e) {
        vscode.window.showErrorMessage(`Commit Defender: Cannot create ${hookDir} — ${e.message}`);
        return;
    }
    // If a non-Commit-Defender hook already exists, refuse rather than clobber.
    let existing = '';
    try {
        existing = fs.readFileSync(hookPath, 'utf8');
    }
    catch { /* none */ }
    if (existing && !existing.includes(HOOK_SIGNATURE)) {
        const action = await vscode.window.showWarningMessage('Commit Defender: A pre-commit hook already exists. Replacing it would discard the current contents.', { modal: true }, 'Replace', 'Cancel');
        if (action !== 'Replace') {
            channel.appendLine('[Commit Defender] Pre-commit hook install cancelled — existing hook preserved.');
            return;
        }
        // Back up the existing hook so the user can restore manually.
        const backup = `${hookPath}.backup-${Date.now()}`;
        try {
            fs.writeFileSync(backup, existing);
            channel.appendLine(`[Commit Defender] Backed up existing hook to ${backup}`);
        }
        catch (e) {
            channel.appendLine(`[Commit Defender] Could not back up existing hook: ${e.message}`);
        }
    }
    fs.writeFileSync(hookPath, buildHookScript(extensionPath), { mode: 0o755 });
    // Some filesystems clear the mode flag on write — re-chmod to be safe.
    try {
        fs.chmodSync(hookPath, 0o755);
    }
    catch { /* best-effort */ }
    writeHookConfig(repoRoot, cfg);
    channel.appendLine(`[Commit Defender] Pre-commit hook installed at ${hookPath}`);
    vscode.window.showInformationMessage('Commit Defender: Pre-commit hook installed. Commits in this repo will be reviewed automatically — even outside VS Code.');
}
async function uninstallHook(repoRoot) {
    const channel = (0, outputChannel_js_1.getOutputChannel)();
    const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-commit');
    let existing = '';
    try {
        existing = fs.readFileSync(hookPath, 'utf8');
    }
    catch {
        vscode.window.showInformationMessage('Commit Defender: No pre-commit hook found.');
        return;
    }
    if (!existing.includes(HOOK_SIGNATURE)) {
        vscode.window.showInformationMessage('Commit Defender: Pre-commit hook was not installed by Commit Defender — skipping removal.');
        return;
    }
    try {
        fs.unlinkSync(hookPath);
        channel.appendLine(`[Commit Defender] Removed pre-commit hook at ${hookPath}`);
    }
    catch (e) {
        vscode.window.showErrorMessage(`Commit Defender: Could not remove hook — ${e.message}`);
        return;
    }
    // Leave .commit-defender/hook.json in place — the user may have other tooling
    // referencing it. Removal of the hook does not require removing the config.
    vscode.window.showInformationMessage('Commit Defender: Pre-commit hook removed.');
}
/** True when a Commit-Defender-signed hook is currently installed. */
function hookIsInstalled(repoRoot) {
    try {
        return fs.readFileSync(path.join(repoRoot, '.git', 'hooks', 'pre-commit'), 'utf8')
            .includes(HOOK_SIGNATURE);
    }
    catch {
        return false;
    }
}
/** Path to the hook config file inside a repo. */
function hookConfigPath(repoRoot) {
    return path.join(repoRoot, CONFIG_DIR, CONFIG_FILE);
}
//# sourceMappingURL=install.js.map