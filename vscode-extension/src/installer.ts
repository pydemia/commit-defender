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

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { getOutputChannel } from './outputChannel.js';

const PYPI_PACKAGE = 'commit-defender';

/**
 * Ensure the Python backend is installed and matches `expectedVersion`.
 * Silently returns if everything is already in order.
 */
export async function ensurePackageInstalled(
  pythonExecutable: string,
  expectedVersion: string,
  context: vscode.ExtensionContext,
): Promise<void> {
  const stateKey = `pkgVersion:${pythonExecutable}`;
  const cachedVersion = context.globalState.get<string>(stateKey);

  // Fast path: we already installed this exact version for this Python binary.
  // Still run a quick import check in case the venv was recreated.
  if (cachedVersion === expectedVersion) {
    const ok = await isImportable(pythonExecutable);
    if (ok) { return; }
  }

  // Slow path: package is missing or version changed — install / upgrade.
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Commit Defender: installing Python backend (${PYPI_PACKAGE} v${expectedVersion})…`,
      cancellable: false,
    },
    async () => {
      const channel = getOutputChannel();
      channel.appendLine(
        `\n[Commit Defender] Installing ${PYPI_PACKAGE}==${expectedVersion} ` +
        `into ${pythonExecutable} …`
      );

      const installed = await pipInstall(pythonExecutable, expectedVersion, channel);

      if (installed) {
        await context.globalState.update(stateKey, expectedVersion);
        channel.appendLine(`[Commit Defender] Python backend installed successfully.`);
      } else {
        // Installation failed — warn and let the user run manually.
        channel.appendLine(
          `[Commit Defender] Auto-install failed.  ` +
          `Run manually:\n  ${pythonExecutable} -m pip install ${PYPI_PACKAGE}`
        );
        channel.show(true);
        vscode.window.showWarningMessage(
          `Commit Defender: could not install Python backend automatically.`,
          'Show Output',
        ).then(action => { if (action === 'Show Output') { channel.show(); } });
      }
    },
  );
}

// ── Pre-commit hook management ────────────────────────────────────────────────

const HOOK_SIGNATURE = 'commit-defender';

/**
 * Ensure the git pre-commit hook is installed in `repoRoot`.
 * Does nothing if the hook already contains the commit-defender signature.
 * Silently skips if `repoRoot` has no `.git` directory.
 */
export async function ensurePreCommitHook(
  pythonExecutable: string,
  repoRoot: string,
): Promise<void> {
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-commit');

  // Already installed?
  try {
    const content = fs.readFileSync(hookPath, 'utf8');
    if (content.includes(HOOK_SIGNATURE)) { return; }
  } catch {
    // File doesn't exist — proceed to install
  }

  const channel = getOutputChannel();
  channel.appendLine(`\n[Commit Defender] Installing pre-commit hook in ${repoRoot} …`);

  const ok = await runInstall(pythonExecutable, repoRoot, channel);
  if (ok) {
    channel.appendLine('[Commit Defender] Pre-commit hook installed.');
    vscode.window.showInformationMessage(
      'Commit Defender: Pre-commit hook installed. Commits in this repo will now be reviewed automatically.',
    );
  } else {
    channel.appendLine('[Commit Defender] Pre-commit hook installation failed. Run manually: commit-defender install .');
    vscode.window.showWarningMessage(
      'Commit Defender: Could not install pre-commit hook automatically.',
      'Show Output',
    ).then(action => { if (action === 'Show Output') { channel.show(); } });
  }
}

/**
 * Remove the commit-defender pre-commit hook from `repoRoot`.
 * Does nothing if the hook was not installed by commit-defender.
 */
export async function uninstallPreCommitHook(
  pythonExecutable: string,
  repoRoot: string,
): Promise<void> {
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-commit');

  try {
    const content = fs.readFileSync(hookPath, 'utf8');
    if (!content.includes(HOOK_SIGNATURE)) {
      vscode.window.showInformationMessage(
        'Commit Defender: Pre-commit hook was not installed by Commit Defender — skipping removal.',
      );
      return;
    }
  } catch {
    vscode.window.showInformationMessage('Commit Defender: No pre-commit hook found.');
    return;
  }

  const channel = getOutputChannel();
  channel.appendLine(`\n[Commit Defender] Uninstalling pre-commit hook from ${repoRoot} …`);

  const ok = await runPythonHook(pythonExecutable, ['uninstall', repoRoot], channel);
  if (ok) {
    channel.appendLine('[Commit Defender] Pre-commit hook removed.');
    vscode.window.showInformationMessage('Commit Defender: Pre-commit hook removed.');
  } else {
    channel.appendLine('[Commit Defender] Pre-commit hook removal failed. Run manually: commit-defender uninstall .');
    vscode.window.showWarningMessage(
      'Commit Defender: Could not remove pre-commit hook automatically.',
      'Show Output',
    ).then(action => { if (action === 'Show Output') { channel.show(); } });
  }
}

/** Run `python -m commit_defender.entrypoint install <repoRoot> --force`. */
function runInstall(python: string, repoRoot: string, channel: vscode.OutputChannel): Promise<boolean> {
  return runPythonHook(python, ['install', repoRoot, '--force'], channel);
}

function runPythonHook(python: string, args: string[], channel: vscode.OutputChannel): Promise<boolean> {
  return new Promise(resolve => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(python, ['-m', 'commit_defender.entrypoint', ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolve(false);
      return;
    }
    proc.stdout?.on('data', (d: Buffer) => channel.append(d.toString()));
    proc.stderr?.on('data', (d: Buffer) => channel.append(d.toString()));
    proc.on('close', code => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true if `commit_defender` can be imported by this Python binary. */
function isImportable(python: string): Promise<boolean> {
  return new Promise(resolve => {
    const proc = spawn(python, ['-c', 'import commit_defender'], { stdio: 'ignore' });
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
async function pipInstall(
  python: string,
  version: string,
  channel: vscode.OutputChannel,
): Promise<boolean> {
  // First try the pinned version.
  const pinned = await runPip(python, [`${PYPI_PACKAGE}==${version}`], channel);
  if (pinned) { return true; }

  // Pinned version may not be on PyPI yet — fall back to latest.
  channel.appendLine(
    `[Commit Defender] Pinned version not found; installing latest ${PYPI_PACKAGE}…`
  );
  return runPip(python, [PYPI_PACKAGE], channel);
}

/** Runs `python -m pip install <packages>` and streams output to the channel. */
function runPip(
  python: string,
  packages: string[],
  channel: vscode.OutputChannel,
): Promise<boolean> {
  return new Promise(resolve => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(python, ['-m', 'pip', 'install', ...packages], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolve(false);
      return;
    }

    proc.stdout?.on('data', (d: Buffer) => channel.append(d.toString()));
    proc.stderr?.on('data', (d: Buffer) => channel.append(d.toString()));
    proc.on('close', code => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}
