import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { defaultLocalDataDirectory, PlatformLocalKeyStore } from '@gcr/client-core';
import { windowsNative } from '@gcr/client-core/windows-native';

assert.equal(process.platform, 'win32');
for (const key of ['W02_EXTENSION', 'W02_VSCODE', 'W02_EVIDENCE'])
  assert(process.env[key] && path.isAbsolute(process.env[key]), key);
const root = await mkdtemp(path.join(os.tmpdir(), 'cd-w02-host-'));
const workspace = path.join(root, '한글 공백 workspace');
const profileId = `w02-${randomUUID()}`;
const git = (...args) => execFileSync('git', ['-C', workspace,
  '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
  '-c', 'user.name=W02 Fixture', '-c', 'user.email=fixture@example.invalid',
  ...args], { stdio: 'pipe', windowsHide: true });
let hostExited = false;
try {
  await mkdir(workspace);
  git('init', '-b', 'main');
  const files = {
    'sum.ts': 'export function sum(values: number[]): number {\r\n  return values.reduce((total, value) => total + value, 0);\r\n}\r\n',
    'consumer.ts': "import { sum } from './sum.ts';\nexport function invoiceTotal(prices: number[]) { return sum(prices); }\n",
    'sum.test.ts': "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { invoiceTotal } from './consumer.ts';\ntest('adds prices', () => assert.equal(invoiceTotal([2, 3]), 5));\ntest('empty total', () => assert.equal(invoiceTotal([]), 0));\n",
    'package.json': '{"name":"w02-synthetic-fixture","private":true,"type":"module"}\n',
  };
  for (const [name, value] of Object.entries(files)) await writeFile(path.join(workspace, name), value);
  git('add', '.'); git('commit', '-m', 'synthetic W02 baseline');
  await writeFile(path.join(workspace, 'sum.ts'), files['sum.ts'].replace('total + value', 'total - value'));
  await writeFile(path.join(workspace, '.env'), 'W02_EXCLUDED_SECRET=synthetic\n');
  git('add', 'sum.ts');
  let defectConfirmed = false;
  try {
    execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'sum.test.ts'], {
      cwd: workspace, encoding: 'utf8', windowsHide: true, stdio: 'pipe',
    });
  } catch (error) {
    assert.equal(error.status, 1);
    assert(String(error.stdout).includes('not ok 1'));
    assert(String(error.stdout).includes('ok 2'));
    defectConfirmed = true;
  }
  assert(defectConfirmed, 'The fixture must reproduce the defect before a model call');
  await writeFile(process.env.W02_EVIDENCE, JSON.stringify({
    status: 'host-starting', realModel: false, modelCalls: 0,
    fixtureDefectReproduced: true,
  }, null, 2) + '\n');
  const configuration = path.join(root, 'configuration.json');
  await writeFile(configuration, JSON.stringify({ workspace, profileId,
    syntheticResponse: true, maximumReviewInvocations: 0,
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
  const sharedData = path.join(root, 'shared-data');
  const storage = path.join(sharedData, 'sharedStorage');
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
  // --extensionTestsPath replaces VS Code's storage with an empty in-memory DB.
  // Use a disposable startup extension so normal fixture-only trust is retained.
  const harness = path.join(root, 'acceptance-extension');
  await mkdir(harness);
  await writeFile(path.join(harness, 'package.json'), JSON.stringify({
    name: 'w02-native-acceptance', publisher: 'gcr-test', version: '1.0.0',
    engines: { vscode: '^1.137.0' }, main: './extension.cjs',
    activationEvents: ['onStartupFinished'],
    capabilities: { untrustedWorkspaces: { supported: true } },
  }));
  await writeFile(path.join(harness, 'extension.cjs'),
    `exports.activate=async()=>{try{await require(${JSON.stringify(path.resolve('out-test/w02-native-host.cjs'))}).run();}catch(e){console.error(e);}finally{await require('vscode').commands.executeCommand('workbench.action.quit');}};`);
  try {
    const environment = { ...process.env, W02_CONFIGURATION: configuration,
      W02_EVIDENCE: process.env.W02_EVIDENCE };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = await windowsNative({
      operation: 'process', command: process.env.W02_VSCODE, cwd: root,
      args: [workspace, '--user-data-dir', userData, '--extensions-dir',
        path.join(root, 'extensions'), '--disable-extensions', '--skip-welcome',
        '--shared-data-dir', sharedData,
        '--skip-release-notes', '--disable-updates',
        `--extensionDevelopmentPath=${process.env.W02_EXTENSION}`,
        `--extensionDevelopmentPath=${harness}`],
      env: environment, stdin: '', maximum: 4 * 1024 * 1024, timeout: 420000,
    }, { timeoutMs: 425000 });
    await writeFile(process.env.W02_EVIDENCE + '.host.log',
      (result.stdout ?? '') + '\n' + (result.stderr ?? ''));
    if (result.error || result.code !== 0)
      throw Error(`Verification Host failed: ${result.error ?? result.code}`);
    assert.equal(JSON.parse(await readFile(process.env.W02_EVIDENCE, 'utf8')).status, 'passed');
  } finally { hostExited = true; }
} finally {
  // Remove only this generated profile, after the test Host exits.
  if (hostExited) {
    const base = defaultLocalDataDirectory();
    const owned = [];
    const discover = async (directory) => {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
        const next = path.join(directory, entry.name);
        if (entry.name === profileId && path.basename(directory) === 'profiles') owned.push(next);
        else await discover(next);
      }
    };
    await discover(base);
    const keys = new PlatformLocalKeyStore();
    for (const directory of owned) {
      assert(path.resolve(directory).toLowerCase().startsWith(path.resolve(base).toLowerCase() + path.sep));
      const local = path.join(directory, 'local', 'key-ref.json');
      try {
        const reference = JSON.parse(await readFile(local, 'utf8'));
        assert.equal(reference.profileId, profileId);
        await keys.remove(`${profileId}.${reference.id}`);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rm(directory, { recursive: true, force: true });
    }
    await rm(root, { recursive: true, force: true });
    const proof = JSON.parse(await readFile(process.env.W02_EVIDENCE, 'utf8'));
    proof.testHostExited = true;
    proof.temporaryProfileAndKeyRemoved = true;
    proof.fixtureDefectReproduced = true;
    await writeFile(process.env.W02_EVIDENCE, JSON.stringify(proof, null, 2) + '\n');
  } else { await rm(root, { recursive: true, force: true }); }
}
