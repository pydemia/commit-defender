/** Command, SCM routing and draft preservation in the real Extension Host.
 * The executable is a synthetic fixture: no account or model service is used. */
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const koreanMessage = '[Fix] 스테이징한 fixture 변경 설명';
const englishMessage = '[Fix] Describe the staged fixture';

export async function run(): Promise<void> {
  const clipboard = await vscode.env.clipboard.readText();
  try { await checkCommand(); }
  finally {
    if ([koreanMessage, englishMessage].includes(await vscode.env.clipboard.readText()))
      await vscode.env.clipboard.writeText(clipboard);
  }
}

async function checkCommand(): Promise<void> {
  const root = process.env.CD_MESSAGE_FIXTURE!;
  const evidence = process.env.CD_MESSAGE_EVIDENCE!;
  const callsFile = path.join(root, 'calls.jsonl');
  const calls = () => existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  const extension = vscode.extensions.getExtension('pydemia.commit-defender')!;
  await extension.activate();
  assert(extension.packageJSON.contributes.menus['scm/title'].some((item: any) => item.command === 'commitDefender.generateCommitMessage'));
  assert.equal(extension.packageJSON.enabledApiProposals, undefined);
  const git = vscode.extensions.getExtension('vscode.git')!;
  await git.activate();
  const api = git.exports.getAPI(1);
  const firstRoot = path.join(root, 'first');
  const secondRoot = path.join(root, 'second');
  const until = async (condition: () => boolean) => {
    for (let i = 0; i < 200 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert(condition(), 'Fixture condition did not become true');
  };
  await until(() => api.repositories.length === 2);
  const first = api.getRepository(vscode.Uri.file(firstRoot));
  const second = api.getRepository(vscode.Uri.file(secondRoot));
  assert(first && second);
  first.inputBox.value = 'Preserve first repository draft';
  second.inputBox.value = 'Preserve second repository draft';
  const scm = vscode.scm.createSourceControl('commit-message-fixture', 'Commit message fixture', vscode.Uri.file(secondRoot));
  const command = () => vscode.commands.executeCommand('commitDefender.generateCommitMessage', scm);
  const stage = (file: string) => execFileSync('git', ['-C', secondRoot, 'add', '--', file]);
  const unstage = () => execFileSync('git', ['-C', secondRoot, 'reset', '--quiet']);
  await command();
  assert.equal(calls().length, 0, 'An empty index must not call the provider');
  assert.equal(second.inputBox.value, 'Preserve second repository draft');

  writeFileSync(path.join(secondRoot, '.env'), 'SYNTHETIC_SOURCE_POLICY_FIXTURE=true\n');
  stage('.env');
  await command();
  assert.equal(calls().length, 0, 'Excluded staged paths must not call the provider');
  unstage();

  writeFileSync(path.join(secondRoot, 'fixture.ts'), 'export const SECOND_REPOSITORY = 2;\n');
  stage('fixture.ts');
  writeFileSync(path.join(root, 'phase'), 'success');
  await command();
  assert.equal(calls().length, 1);
  assert.equal(realpathSync(calls()[0].cwd), realpathSync(secondRoot));
  assert(calls()[0].text.includes('SECOND_REPOSITORY = 2'));
  assert(!calls()[0].text.includes('FIRST_REPOSITORY'));
  assert(calls()[0].text.includes('제목과 본문은 한국어로 작성하세요'));
  assert(!calls()[0].text.includes('Write the title and body in English'));
  assert.equal(second.inputBox.value, koreanMessage);
  assert.equal(first.inputBox.value, 'Preserve first repository draft');

  await vscode.workspace.getConfiguration('commitDefender').update('locale', 'en', vscode.ConfigurationTarget.Global);
  await command();
  assert.equal(calls().length, 2);
  assert(calls()[1].text.includes('Write the title and body in English'));
  assert(!calls()[1].text.includes('제목과 본문은 한국어로 작성하세요'));
  assert.equal(second.inputBox.value, englishMessage);
  await vscode.workspace.getConfiguration('commitDefender').update('locale', 'ko', vscode.ConfigurationTarget.Global);

  writeFileSync(path.join(root, 'phase'), 'delayed');
  const pending = command();
  await until(() => calls().length === 3);
  second.inputBox.value = 'Draft typed while generation was running';
  await pending;
  assert.equal(second.inputBox.value, 'Draft typed while generation was running');
  assert(calls()[2].text.includes('제목과 본문은 한국어로 작성하세요'));
  assert(vscode.workspace.textDocuments.some(doc => doc.languageId === 'git-commit' && doc.getText() === koreanMessage));
  assert.equal(first.inputBox.value, 'Preserve first repository draft');

  writeFileSync(path.join(root, 'phase'), 'failure');
  await command();
  assert.equal(calls().length, 4);
  assert.equal(second.inputBox.value, 'Draft typed while generation was running');
  writeFileSync(evidence, JSON.stringify({
    status: 'passed', vscode: vscode.version, extension: extension.packageJSON.version,
    delivery: process.env.CD_MESSAGE_DELIVERY, locales: ['ko', 'en'], modelCalls: 0, syntheticCalls: calls().length,
    checks: ['empty index without provider request', 'excluded staged input without provider request',
      'SCM repository argument', 'Korean locale request and Korean SCM insertion',
      'English locale request and English SCM insertion', 'other repository draft preservation',
      'concurrent draft preservation and separate preview', 'provider failure without draft overwrite'],
  }, null, 2) + '\n');
  scm.dispose();
}
