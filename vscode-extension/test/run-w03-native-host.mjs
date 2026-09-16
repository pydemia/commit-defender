import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { callLocalService, defaultLocalDataDirectory, PlatformLocalKeyStore } from '@gcr/client-core';
import { windowsNative } from '@gcr/client-core/windows-native';

assert.equal(process.platform, 'win32');
for (const key of ['W03_EXTENSION', 'W03_CODEX', 'W03_VSCODE', 'W03_EVIDENCE'])
  assert(process.env[key] && path.isAbsolute(process.env[key]), key);
const root = await mkdtemp(path.join(os.tmpdir(), 'cd-w03-host-'));
const workspace = path.join(root, '한글 공백 workspace');
const profileId = `w03-${randomUUID()}`;
const git = (...args) => execFileSync('git', ['-C', workspace,
  '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
  '-c', 'user.name=W03 Fixture', '-c', 'user.email=fixture@example.invalid',
  ...args], { stdio: 'pipe', windowsHide: true });
let hostExited = false;
const dataDirectory = defaultLocalDataDirectory();
const programs = path.join(dataDirectory, 'service-programs');
const previousPrograms = new Set(await readdir(programs).catch(error => {
  if (error.code === 'ENOENT') return []; throw error;
}));
try {
  await mkdir(workspace);
  git('init', '-b', 'main');
  const files = {
    'sum.ts': 'export function sum(values: number[]): number {\r\n  return values.reduce((total, value) => total + value, 0);\r\n}\r\n',
    'consumer.ts': "import { sum } from './sum.ts';\nexport function invoiceTotal(prices: number[]) { return sum(prices); }\n",
    'sum.test.ts': "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { invoiceTotal } from './consumer.ts';\ntest('adds prices', () => assert.equal(invoiceTotal([2, 3]), 5));\ntest('empty total', () => assert.equal(invoiceTotal([]), 0));\n",
    'package.json': '{"name":"w03-synthetic-fixture","private":true,"type":"module"}\n',
  };
  for (const [name, value] of Object.entries(files)) await writeFile(path.join(workspace, name), value);
  git('add', '.'); git('commit', '-m', 'synthetic W03 baseline');
  await mkdir(path.join(workspace, '.hooks'));
  await writeFile(path.join(workspace, '.hooks/pre-commit'), '#!/bin/sh\nexit 0\n');
  execFileSync('git', ['-C', workspace, 'config', 'core.hooksPath', '.hooks'], { windowsHide: true });
  await writeFile(path.join(workspace, 'sum.ts'), files['sum.ts'].replace('total + value', 'total - value'));
  await writeFile(path.join(workspace, '.env'), 'W03_EXCLUDED_SECRET=synthetic\n');
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
  await writeFile(process.env.W03_EVIDENCE, JSON.stringify({
    status: 'host-starting', realModel: false, modelCalls: 0,
    fixtureDefectReproduced: true,
  }, null, 2) + '\n');
  const configuration = path.join(root, 'configuration.json');
  await writeFile(configuration, JSON.stringify({ workspace, profileId,
    model: 'gpt-5.6-luna', reasoningEffort: 'high', durationMs: 240000,
    executablePath: process.env.W03_CODEX,
    maximumReviewInvocations: process.env.W03_LIFECYCLE_ONLY === '1' ? 0 : 1,
  }));
  const userData = path.join(root, 'user-data');
  await mkdir(path.join(userData, 'User'), { recursive: true });
  await writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({
    'commitDefender.localProfile': profileId,
    'commitDefender.reviewMode': 'standalone',
    'commitDefender.runOnSave': false, 'commitDefender.runOnStage': false,
    'commitDefender.runOnCommit': false, 'commitDefender.runOnPush': false,
    'commitDefender.aiProvider': 'codex', 'commitDefender.model': 'gpt-5.6-luna',
    'commitDefender.reviewReasoningEffort': 'high',
    'commitDefender.codexPath': process.env.W03_CODEX,
    'commitDefender.serviceNodePath': process.execPath,
    'commitDefender.fileTimeoutSeconds': 240,
    'commitDefender.directoryTimeoutSeconds': 240,
    'commitDefender.automaticReviewsPerHour': 1,
    'commitDefender.automaticReviewsPaused': false,
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
    name: 'w03-native-acceptance', publisher: 'gcr-test', version: '1.0.0',
    engines: { vscode: '^1.137.0' }, main: './extension.cjs',
    activationEvents: ['onStartupFinished'],
    capabilities: { untrustedWorkspaces: { supported: true } },
  }));
  await writeFile(path.join(harness, 'extension.cjs'),
    `exports.activate=async()=>{try{await require(${JSON.stringify(path.resolve('out-test/w03-native-host.cjs'))}).run();}catch(e){console.error(e);}finally{await require('vscode').commands.executeCommand('workbench.action.quit');}};`);
  try {
    const environment = { ...process.env, W03_CONFIGURATION: configuration,
      W03_EVIDENCE: process.env.W03_EVIDENCE };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = await windowsNative({
      operation: 'process', command: process.env.W03_VSCODE, cwd: root,
      args: [workspace, '--user-data-dir', userData, '--extensions-dir',
        path.join(root, 'extensions'), '--disable-extensions', '--skip-welcome',
        '--shared-data-dir', sharedData,
        '--skip-release-notes', '--disable-updates',
        `--extensionDevelopmentPath=${process.env.W03_EXTENSION}`,
        `--extensionDevelopmentPath=${harness}`],
        env: environment, stdin: '', maximum: 4 * 1024 * 1024, timeout: 480000,
    }, { timeoutMs: 485000 });
    await writeFile(process.env.W03_EVIDENCE + '.host.log',
      (result.stdout ?? '') + '\n' + (result.stderr ?? ''));
    const hostProof = JSON.parse(await readFile(process.env.W03_EVIDENCE, 'utf8'));
    hostProof.hostLauncher = { code: result.code ?? null,
      error: result.error ?? null };
    await writeFile(process.env.W03_EVIDENCE, JSON.stringify(hostProof, null, 2) + '\n');
    if (result.error || result.code !== 0)
      throw Error(`Verification Host failed: ${result.error ?? result.code}`);
    assert.equal(JSON.parse(await readFile(process.env.W03_EVIDENCE, 'utf8')).status, 'passed');
  } finally { hostExited = true; }
} finally {
  // Remove only this generated profile, after the test Host exits.
  if (hostExited) {
    const proof = JSON.parse(await readFile(process.env.W03_EVIDENCE, 'utf8'));
    try {
      const status = await callLocalService({ profileId }, { action:'status' }, 1000);
      assert(!proof.servicePid || proof.servicePid === status.pid);
      await callLocalService({ profileId }, { action:'stop' });
      const deadline = Date.now() + 30000;
      let stopped = false;
      while (Date.now() < deadline) {
        try { process.kill(status.pid, 0); }
        catch (error) { if (error.code === 'ESRCH') { stopped = true; break; } throw error; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert(stopped, 'Owned service termination unconfirmed.');
      proof.serviceStopped = true;
      await writeFile(process.env.W03_EVIDENCE, JSON.stringify(proof, null, 2) + '\n');
    } catch (error) {
      if (error.code !== 'service-unavailable') throw error;
      if (proof.servicePid) {
        let exists = true;
        try { process.kill(proof.servicePid, 0); }
        catch (failure) { if (failure.code === 'ESRCH') exists = false; else throw failure; }
        assert(!exists, 'IPC unavailable while owned service is still alive; retain fixture.');
      }
      proof.serviceUnavailableAtCleanup = true;
    }
    const keys = new PlatformLocalKeyStore();
    for (const area of ['', 'review-requests', 'local-service']) {
      const directory = path.join(dataDirectory, area, 'profiles', profileId);
      try {
        const reference = JSON.parse(await readFile(path.join(directory, 'local', 'key-ref.json'), 'utf8'));
        assert.equal(reference.profileId, profileId);
        await keys.remove(`${profileId}.${reference.id}`);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rm(directory, { recursive: true, force: true });
    }
    if (proof.hookDirectory) {
      assert(path.resolve(proof.hookDirectory).startsWith(path.join(dataDirectory, 'managed-hooks') + path.sep));
      await rm(proof.hookDirectory, { recursive:true, force:true });
    }
    // Only the exact new service program used by this isolated Host is eligible.
    for (const program of [proof.serviceProgram, proof.advisoryProgram].filter(Boolean)) {
      const owned = path.dirname(path.resolve(program));
      assert.equal(path.dirname(owned), programs);
      if (!previousPrograms.has(path.basename(owned))) await rm(owned, { recursive:true, force:true });
    }
    await rm(root, { recursive: true, force: true });
    proof.testHostExited = true;
    proof.temporaryProfileAndKeyRemoved = true;
    proof.fixtureDefectReproduced = true;
    await writeFile(process.env.W03_EVIDENCE, JSON.stringify(proof, null, 2) + '\n');
  } else { await rm(root, { recursive: true, force: true }); }
}
