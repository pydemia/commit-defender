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
