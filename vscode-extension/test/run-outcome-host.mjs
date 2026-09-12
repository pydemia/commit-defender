import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'cd-outcome-host-'));
const workspace = path.join(temporary, 'CD Outcome Verification');
const control = path.join(temporary, 'control');
const evidence = path.join(root, 'test-results', 'outcome-host');
try {
  await mkdir(workspace);
  await mkdir(control);
  await mkdir(path.join(workspace, '.vscode'));
  execFileSync('git', ['init', '-b', 'main'], {
    cwd: workspace,
    stdio: 'ignore',
  });
  for (const file of ['first.ts', 'second.ts'])
    await writeFile(path.join(workspace, file), 'export const value = 1;\n');
  const executable = path.join(temporary, 'fake-codex');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'); const control = ${JSON.stringify(control)};
let text = ''; process.stdin.on('data', chunk => text += chunk);
process.stdin.on('end', () => {
  const { phase } = JSON.parse(fs.readFileSync(path.join(control, 'provider.json'), 'utf8'));
  const second = text.includes('### second.ts');
  fs.appendFileSync(path.join(control, 'requests.jsonl'), JSON.stringify({ phase, file: second ? 'second.ts' : 'first.ts' }) + '\\n');
  if (phase === 'failed' || (phase === 'partial' && second)) { process.stderr.write('Synthetic provider unavailable.'); process.exit(3); }
  if (phase === 'cancelled' && second) { fs.writeFileSync(path.join(control, 'waiting'), 'ready'); return setTimeout(() => process.stdout.write('{}'), 120000); }
  process.stdout.write(JSON.stringify({summary:'Synthetic review of saved source.',blocking:false,grade:'proficient',file_comments:second?[]:[{file:'first.ts',line:1,comment:'Synthetic finding retained from the completed file.',category:'correctness',priority:'P2'}]}));
});
`,
    { mode: 0o700 },
  );
  await writeFile(
    path.join(workspace, '.vscode', 'settings.json'),
    JSON.stringify({
      'commitDefender.aiProvider': 'codex',
      'commitDefender.codexPath': executable,
      'commitDefender.preCommitHook': 'disable',
      'commitDefender.runOnStage': false,
      'commitDefender.repoAnalysisWarnThreshold': 0,
      'commitDefender.fileTimeoutSeconds': 0,
      'commitDefender.directoryTimeoutSeconds': 0,
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'extensions.autoUpdate': false,
      'window.zoomLevel': -1,
      'workbench.startupEditor': 'none',
    }),
  );
  await rm(evidence, { recursive: true, force: true });
  console.log(`OUTCOME_CONTROL=${control}`);
  await runTests({
    vscodeExecutablePath:
      process.env.VSCODE_EXECUTABLE_PATH ||
      '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'out-test', 'outcome-host.cjs'),
    extensionTestsEnv: {
      CD_TEST_WORKSPACE: workspace,
      CD_OUTCOME_CONTROL: control,
    },
    launchArgs: [
      workspace,
      '--user-data-dir',
      path.join(temporary, 'user-data'),
      '--extensions-dir',
      path.join(temporary, 'extensions'),
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-updates',
      '--disable-telemetry',
    ],
  });
  await cp(control, evidence, { recursive: true });
  console.log(`Outcome evidence: ${evidence}`);
} catch (error) {
  await cp(control, evidence, { recursive: true });
  await writeFile(
    path.join(evidence, 'attempt.json'),
    JSON.stringify({ status: 'failed', error: String(error) }) + '\n',
  );
  throw error;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
