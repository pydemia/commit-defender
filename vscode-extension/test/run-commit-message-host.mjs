import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(path.join(tmpdir(), 'cd-message-host-'));
const evidence = path.join(extensionRoot, 'test-results', `commit-message-host-${process.env.CD_TEST_EXTENSION_PATH ? 'packaged' : 'source'}.json`);
try {
  await mkdir(path.dirname(evidence), { recursive: true });
  await rm(evidence, { force: true });
  for (const [name, marker] of [['first', 'FIRST_REPOSITORY'], ['second', 'SECOND_REPOSITORY']]) {
    const repo = path.join(root, name);
    await mkdir(repo);
    const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore' });
    git('init', '-b', 'main');
    git('config', 'user.name', 'Commit Message Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    await writeFile(path.join(repo, 'fixture.ts'), `export const ${marker} = 1;\n`);
    git('add', 'fixture.ts');
    git('commit', '-m', 'Fixture baseline');
  }
  const executable = path.join(root, 'fake-codex');
  await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), root = ${JSON.stringify(root)};
let text = ''; process.stdin.on('data', chunk => text += chunk);
process.stdin.on('end', () => {
  fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({cwd:process.cwd(), text}) + '\\n');
  const phase = fs.readFileSync(path.join(root, 'phase'), 'utf8');
  if (phase === 'failure') { process.stderr.write('Synthetic provider unavailable.'); process.exit(3); }
  const message = text.includes('제목과 본문은 한국어로 작성하세요')
    ? '[Fix] 스테이징한 fixture 변경 설명' : '[Fix] Describe the staged fixture';
  const reply = () => process.stdout.write(JSON.stringify({commit_message:message}));
  if (phase === 'delayed') setTimeout(reply, 800); else reply();
});
`, { mode: 0o700 });
  await mkdir(path.join(root, 'user-data', 'User'), { recursive: true });
  await writeFile(path.join(root, 'user-data', 'User', 'settings.json'), JSON.stringify({
    'commitDefender.aiProvider': 'codex', 'commitDefender.codexPath': executable,
    'commitDefender.model': 'synthetic-model', 'commitDefender.locale': 'ko', 'commitDefender.preCommitHook': 'disable',
    'commitDefender.runOnStage': false, 'commitDefender.runOnSave': false,
    'commitDefender.excludePatterns': ['.env'], 'commitDefender.fileTimeoutSeconds': 15,
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false,
    'workbench.startupEditor': 'none',
  }));
  const workspace = path.join(root, 'fixture.code-workspace');
  await writeFile(workspace, JSON.stringify({ folders: [{path:path.join(root, 'first')}, {path:path.join(root, 'second')}] }));
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    extensionDevelopmentPath: process.env.CD_TEST_EXTENSION_PATH || extensionRoot,
    extensionTestsPath: path.join(extensionRoot, 'out-test', 'commit-message-host.cjs'),
    extensionTestsEnv: { CD_MESSAGE_FIXTURE: root, CD_MESSAGE_EVIDENCE: evidence,
      CD_MESSAGE_DELIVERY: process.env.CD_TEST_EXTENSION_PATH ? 'packaged-extension' : 'source-checkout' },
    launchArgs: [workspace, '--user-data-dir', path.join(root, 'user-data'),
      '--extensions-dir', path.join(root, 'extensions'), '--disable-extensions', '--disable-workspace-trust',
      '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry'],
  });
  console.log(`Commit Message Host evidence: ${evidence}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
