import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { defaultLocalDataDirectory, PlatformLocalKeyStore } from '@gcr/client-core';
import { windowsNative } from '@gcr/client-core/windows-native';

assert.equal(process.platform, 'win32');
for (const key of ['W01_EXTENSION', 'W01_CODEX', 'W01_VSCODE', 'W01_EVIDENCE'])
  assert(process.env[key] && path.isAbsolute(process.env[key]), key);
const root = await mkdtemp(path.join(os.tmpdir(), 'cd-w01-host-'));
const workspace = path.join(root, '한글 공백 workspace');
const profileId = `w01-${randomUUID()}`;
const git = (...args) => execFileSync('git', ['-C', workspace,
  '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
  '-c', 'user.name=W01 Fixture', '-c', 'user.email=fixture@example.invalid',
  ...args], { stdio: 'pipe', windowsHide: true });
let hostExited = false;
try {
  await mkdir(workspace);
  git('init', '-b', 'main');
  const files = {
    'sum.ts': 'export function sum(values: number[]): number {\r\n  return values.reduce((total, value) => total + value, 0);\r\n}\r\n',
    'consumer.ts': "import { sum } from './sum.ts';\nexport function invoiceTotal(prices: number[]) { return sum(prices); }\n",
    'sum.test.ts': "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { invoiceTotal } from './consumer.ts';\ntest('adds prices', () => assert.equal(invoiceTotal([2, 3]), 5));\ntest('empty total', () => assert.equal(invoiceTotal([]), 0));\n",
    'package.json': '{"name":"w01-synthetic-fixture","private":true,"type":"module"}\n',
  };
  for (const [name, value] of Object.entries(files)) await writeFile(path.join(workspace, name), value);
  git('add', '.'); git('commit', '-m', 'synthetic W01 baseline');
  await writeFile(path.join(workspace, 'sum.ts'), files['sum.ts'].replace('total + value', 'total - value'));
  await writeFile(path.join(workspace, '.env'), 'W01_EXCLUDED_SECRET=synthetic\n');
  git('add', 'sum.ts');
  let defectConfirmed = false;
  try {
    execFileSync(process.execPath, ['--test', 'sum.test.ts'], {
      cwd: workspace, encoding: 'utf8', windowsHide: true, stdio: 'pipe',
    });
  } catch (error) {
    assert.equal(error.status, 1);
    assert(String(error.stdout).includes('not ok 1'));
    assert(String(error.stdout).includes('ok 2'));
    defectConfirmed = true;
  }
  assert(defectConfirmed, 'The fixture must reproduce the defect before a model call');
  const configuration = path.join(root, 'configuration.json');
  await writeFile(configuration, JSON.stringify({ workspace, profileId,
    model: 'gpt-5.6-luna', reasoningEffort: 'high', durationMs: 240000,
    executablePath: process.env.W01_CODEX, maximumReviewInvocations: 1,
  }));
  const userData = path.join(root, 'user-data');
  await mkdir(path.join(userData, 'User'), { recursive: true });
  await writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({
    'commitDefender.localProfile': profileId,
    'commitDefender.reviewMode': 'standalone',
    'commitDefender.runOnSave': false, 'commitDefender.runOnStage': false,
    'commitDefender.preCommitHook': 'disable',
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none',
    'extensions.autoUpdate': false,
  }));
  // Seed trust for this generated repository only, in the disposable profile.
  // test-electron adds sandbox/trust bypass flags, so launch the Host directly.
  const storage = path.join(userData, 'User', 'globalStorage');
  await mkdir(storage, { recursive: true });
  const database = new DatabaseSync(path.join(storage, 'state.vscdb'));
  try {
    database.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
    database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(
      'content.trust.model.key', JSON.stringify({ uriTrustInfo: [{
        uri: { scheme: 'file', path: '/' + workspace.replaceAll('\\', '/') },
        trusted: true,
      }] }),
    );
  } finally { database.close(); }
  try {
    const environment = { ...process.env, W01_CONFIGURATION: configuration,
      W01_EVIDENCE: process.env.W01_EVIDENCE };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = await windowsNative({
      operation: 'process', command: process.env.W01_VSCODE, cwd: root,
      args: [workspace, '--user-data-dir', userData, '--extensions-dir',
        path.join(root, 'extensions'), '--disable-extensions', '--skip-welcome',
        '--skip-release-notes', '--disable-updates',
        `--extensionDevelopmentPath=${process.env.W01_EXTENSION}`,
        `--extensionTestsPath=${path.resolve('out-test/w01-native-host.cjs')}`],
      env: environment, stdin: '', maximum: 4 * 1024 * 1024, timeout: 420000,
    }, { timeoutMs: 425000 });
    if (result.error || result.code !== 0)
      throw Error(`Verification Host failed: ${result.error ?? result.code}`);
  } finally { hostExited = true; }
} finally {
  // Remove only this generated profile, after the test Host exits.
  if (hostExited) {
    const directory = path.join(defaultLocalDataDirectory(), 'profiles', profileId);
    try {
      const reference = JSON.parse(await readFile(path.join(directory, 'local', 'key-ref.json'), 'utf8'));
      await new PlatformLocalKeyStore().remove(`${profileId}.${reference.id}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rm(directory, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
    const proof = JSON.parse(await readFile(process.env.W01_EVIDENCE, 'utf8'));
    proof.testHostExited = true;
    proof.temporaryProfileAndKeyRemoved = true;
    await writeFile(process.env.W01_EVIDENCE, JSON.stringify(proof, null, 2) + '\n');
  }
}
