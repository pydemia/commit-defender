// Run under dbus-run-session in the user's Linux environment. No secret argv/env.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

assert.equal(process.platform, 'linux');
const [root, extension, output, mode] = process.argv.slice(2);
assert(/^\/tmp\/cd-linux-host-[A-Za-z0-9]+$/.test(root));
assert.equal(fs.realpathSync(root), root);
assert(['probe', 'review'].includes(mode));
assert(path.isAbsolute(extension) && path.isAbsolute(output));
const session = fs.mkdtempSync(path.join(root, 'session-'));
const data = path.join(session, 'data');
fs.mkdirSync(data, { mode: 0o700 });
process.env.XDG_DATA_HOME = data;
const password = randomBytes(32).toString('base64');
const code = path.join(root, 'vscode/code');
const codex = path.join(root, 'codex-aarch64-unknown-linux-musl');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const initialAccount = fs.statSync(path.join(process.env.HOME, '.codex/auth.json'));
const documents = ['AGENTS.md', 'AGENTS.override.md', 'config.toml'];
const accountDocumentHashes = () => Object.fromEntries(documents.map(name => {
  const file = path.join(process.env.HOME, '.codex', name);
  return [name, fs.existsSync(file) ? hash(file) : null];
}));
const before = accountDocumentHashes();
const proof = { status: 'starting', mode, realModelCallsAllowed: mode === 'review' ? 1 : 0,
  platform: process.platform, arch: process.arch, codeSha256: hash(code),
  codexSha256: hash(codex), sessionPath: session, encryptedKeyring: true,
  existingAccountDocumentsUnchanged: false };
const save = () => fs.writeFileSync(output + '.launcher.json', JSON.stringify(proof, null, 2) + '\n');
let keyring;
let host;
const wait = (child, timeoutMs) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error('Owned process did not exit')), timeoutMs);
  child.once('close', code => { clearTimeout(timer); resolve(code); });
  child.once('error', error => { clearTimeout(timer); reject(error); });
});
try {
  keyring = spawn('/usr/bin/gnome-keyring-daemon',
    ['--foreground', '--unlock', '--components=secrets', '--control-directory', path.join(session, 'keyring')],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  keyring.stdin.end(password);
  // Poll for this new bus's Secret Service, never the user's original bus.
  const synthetic = randomBytes(32).toString('base64');
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      execFileSync('/usr/bin/secret-tool', ['store', '--label=GCR Linux verification', 'gcr-test', 'preflight'],
        { input: synthetic, timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] });
      ready = true; break;
    } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert(ready, 'Isolated Secret Service unavailable');
  assert.equal(execFileSync('/usr/bin/secret-tool', ['lookup', 'gcr-test', 'preflight'],
    { encoding: 'utf8', timeout: 3000 }).trim(), synthetic);
  execFileSync('/usr/bin/secret-tool', ['clear', 'gcr-test', 'preflight'], { timeout: 3000 });
  proof.secretServiceRoundTrip = true;
  const workspace = path.join(session, '한글 fixture');
  fs.mkdirSync(workspace, { mode: 0o700 });
  const git = (...args) => execFileSync('/usr/bin/git', ['-C', workspace,
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Linux Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { stdio: 'pipe', timeout: 15000 });
  git('init', '-b', 'main');
  const source = 'export function sum(values: number[]): number {\n  return values.reduce((total, value) => total + value, 0);\n}\n';
  const files = {
    'sum.ts': source,
    'consumer.ts': "import { sum } from './sum.ts';\nexport function invoiceTotal(prices: number[]) { return sum(prices); }\n",
    'sum.test.ts': "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { invoiceTotal } from './consumer.ts';\ntest('adds prices', () => assert.equal(invoiceTotal([2, 3]), 5));\ntest('empty total', () => assert.equal(invoiceTotal([]), 0));\n",
    'package.json': '{"name":"linux-review-fixture","private":true,"type":"module"}\n',
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(workspace, name), text);
  git('add', '.'); git('commit', '-m', 'synthetic baseline');
  fs.writeFileSync(path.join(workspace, 'sum.ts'), source.replace('total + value', 'total - value'));
  fs.writeFileSync(path.join(workspace, '.env'), 'LINUX_EXCLUDED_SECRET=synthetic\n');
  git('add', 'sum.ts');
  let reproduced = false;
  try { execFileSync(process.execPath, ['--test', 'sum.test.ts'], { cwd: workspace, stdio: 'pipe' }); }
  catch (error) { reproduced = error.status === 1 && String(error.stdout).includes('not ok 1') && String(error.stdout).includes('ok 2'); }
  assert(reproduced, 'Defect fixture did not reproduce');
  const userData = path.join(session, 'user-data');
  const storage = path.join(userData, 'User/globalStorage');
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  const profileId = 'linux-host-' + randomUUID();
  fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
    'commitDefender.aiProvider': 'codex', 'commitDefender.model': 'gpt-5.6-luna',
    'commitDefender.reviewReasoningEffort': 'high', 'commitDefender.codexPath': codex,
    'commitDefender.localProfile': profileId, 'commitDefender.reviewMode': 'standalone',
    'commitDefender.runOnSave': false, 'commitDefender.runOnStage': false,
    'commitDefender.runOnCommit': false, 'commitDefender.runOnPush': false,
    'commitDefender.preCommitHook': 'disable', 'update.mode': 'none',
    'extensions.autoUpdate': false, 'telemetry.telemetryLevel': 'off',
  }));
  const database = new DatabaseSync(path.join(storage, 'state.vscdb'));
  database.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
  database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('content.trust.model.key',
    JSON.stringify({ uriTrustInfo: [{ uri: { scheme: 'file', path: workspace }, trusted: true }] }));
  database.close();
  const config = { workspace, profileId, model: 'gpt-5.6-luna', reasoningEffort: 'high',
    durationMs: 240000, maximumReviewInvocations: 1, executablePath: codex,
    workerSha256: hash(path.join(extension, 'out/standalone-review-worker.js')) };
  fs.writeFileSync(path.join(session, 'configuration.json'), JSON.stringify(config));
  const harness = path.join(session, 'harness');
  fs.mkdirSync(harness);
  fs.writeFileSync(path.join(harness, 'package.json'), JSON.stringify({
    name: 'linux-account-verification', publisher: 'gcr-test', version: '1.0.0',
    engines: { vscode: '^1.137.0' }, main: './extension.cjs', activationEvents: ['onStartupFinished'],
    capabilities: { untrustedWorkspaces: { supported: true } },
  }));
  const body = mode === 'review'
    ? `await require(${JSON.stringify(path.resolve('out-test/linux-codex-host.cjs'))}).run();`
    : `const v=require('vscode'); const e=v.extensions.getExtension('pydemia.commit-defender'); await e.activate(); require('fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({status:'passed',modelCalls:0,platform:process.platform,arch:process.arch,vscode:v.version,node:process.version,extensionVersion:e.packageJSON.version,trusted:v.workspace.isTrusted}));`;
  fs.writeFileSync(path.join(harness, 'extension.cjs'), `exports.activate=async()=>{try{${body}}catch(e){console.error(e);}finally{await require('vscode').commands.executeCommand('workbench.action.quit');}};`);
  proof.fixtureDefectReproduced = true;
  proof.fixedSource = Object.fromEntries(Object.keys(files).map(name => [name, hash(path.join(workspace, name))]));
  proof.baseCommit = git('rev-parse', 'HEAD').toString().trim();
  save();
  if (mode === 'review') fs.writeFileSync(path.join(root, 'actual-review-started'), output, { flag: 'wx' });
  const env = { ...process.env, GCR_LINUX_CONFIGURATION: path.join(session, 'configuration.json'),
    GCR_LINUX_EVIDENCE: output };
  delete env.ELECTRON_RUN_AS_NODE;
  host = spawn(code, [workspace, '--user-data-dir', userData, '--extensions-dir', path.join(session, 'extensions'),
    '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-updates',
    `--extensionDevelopmentPath=${extension}`, `--extensionDevelopmentPath=${harness}`],
    { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  for (const stream of [host.stdout, host.stderr]) stream.on('data', bytes => { if(log.length < 200000)log += bytes; });
  proof.hostPid = host.pid;
  proof.hostExitCode = await wait(host, mode === 'review' ? 480000 : 90000);
  fs.writeFileSync(output + '.host.log', log);
  assert.equal(proof.hostExitCode, 0, 'Linux Host launcher failed');
  const observed = JSON.parse(fs.readFileSync(output));
  assert.equal(observed.status, 'passed');
  proof.status = 'passed';
} catch (error) {
  proof.status = 'failed';
  proof.error = error instanceof Error ? error.message : 'Linux verification failed';
  process.exitCode = 1;
} finally {
  if(host) { try { process.kill(-host.pid, 'SIGTERM'); } catch(error) { if(error.code !== 'ESRCH')throw error; } }
  if(keyring) { const exited = wait(keyring, 5000); keyring.kill('SIGTERM'); await exited; }
  proof.existingAccountDocumentsUnchanged = JSON.stringify(before) === JSON.stringify(accountDocumentHashes());
  const account = fs.statSync(path.join(process.env.HOME, '.codex/auth.json'));
  proof.accountInodePreserved = account.ino === initialAccount.ino && account.nlink === initialAccount.nlink;
  assert(proof.existingAccountDocumentsUnchanged && proof.accountInodePreserved);
  fs.rmSync(session, { recursive: true, force: true });
  proof.sessionAndEncryptedKeyringRemoved = !fs.existsSync(session);
  save();
}
