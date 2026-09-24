import { runTests } from '@vscode/test-electron';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proof = path.join(root, 'test-results/native-connection-guide');
const temp = await mkdtemp(path.join(tmpdir(), 'cd-native-guide-'));
try {
  await mkdir(proof, { recursive: true });
  for (const file of ['ready', 'continue', 'host.json']) await rm(path.join(proof, file), { force: true });
  const workspace = path.join(temp, 'Guide verification');
  await mkdir(workspace);
  execFileSync('git', ['init', '-b', 'main', workspace], { stdio: 'ignore' });
  await mkdir(path.join(temp, 'user-data/User'), { recursive: true });
  await writeFile(path.join(temp, 'user-data/User/settings.json'), JSON.stringify({
    'commitDefender.localProfile': 'cd-guide-' + randomUUID(),
    'commitDefender.runOnStage': false, 'commitDefender.preCommitHook': 'disable',
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false,
    'window.title': 'Commit Defender Guide Verification ' + path.basename(temp),
    'workbench.settings.editor': 'json',
  }));
  const executable = process.env.VSCODE_EXECUTABLE_PATH;
  await runTests({
    ...(executable ? { vscodeExecutablePath: executable } : { version: process.env.VSCODE_TEST_VERSION || 'stable' }),
    extensionDevelopmentPath: path.resolve(process.env.CD_TEST_EXTENSION_PATH || root),
    extensionTestsPath: path.join(root, 'test/connection-guide-host.cjs'),
    extensionTestsEnv: {
      VSCODE_DEV: '', CD_GUIDE_INSPECT: process.env.CD_GUIDE_INSPECT || '0',
      CD_GUIDE_INSPECT_LANGUAGE: process.env.CD_GUIDE_INSPECT_LANGUAGE || 'en',
      CD_GUIDE_READY: path.join(proof, 'ready'), CD_GUIDE_CONTINUE: path.join(proof, 'continue'),
      CD_GUIDE_PROOF: path.join(proof, 'host.json'),
      CD_GUIDE_DELIVERY: process.env.CD_TEST_EXTENSION_PATH ? 'packaged-extension' : 'source-checkout',
    },
    launchArgs: [workspace, '--locale', 'en', '--user-data-dir', path.join(temp, 'user-data'),
      '--extensions-dir', path.join(temp, 'extensions'), '--disable-extensions',
      '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry'],
  });
  console.log(`Guide Extension Host evidence: ${path.join(proof, 'host.json')}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
