import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { useAccount, useApiCredential } from '../src/modelSetupView.js';

/** Real Extension Host and account query; only the user's picker answers are
 * scripted. This is API integration evidence, not a rendered-UI assertion. */
export async function checkModelSetup() {
  const configuration = vscode.workspace.getConfiguration('commitDefender');
  const keys = ['aiProvider', 'model', 'reviewReasoningEffort', 'endpoint', 'modelCredentialRef', 'runOnStage'];
  const before = Object.fromEntries(keys.map(key => [key, configuration.inspect(key)?.globalValue]));
  const originalPick = vscode.window.showQuickPick;
  const originalInput = vscode.window.showInputBox;
  const observed: { title: string; labels: string[] }[] = [];
  const nativeWindow = vscode.window as unknown as { showQuickPick: typeof originalPick; showInputBox: typeof originalInput };
  try {
    nativeWindow.showQuickPick = (async (items: any, options: any) => {
      const choices = await items;
      observed.push({ title: options.title, labels: choices.map((item: any) => item.label) });
      if (options.title === 'Commit Defender: Use Account (1/3)') return choices.find((item: any) => item.provider === 'codex');
      if (options.title.includes('Model (2/3)')) return choices.find((item: any) => item.model?.id === 'gpt-5.6-luna');
      if (options.title.includes('Effort (3/3)')) return choices.find((item: any) => item.effort === 'high');
      throw Error('Unexpected picker');
    }) as typeof originalPick;
    nativeWindow.showInputBox = (async () => { throw Error('Account setup must not ask for a model ID or secret'); }) as typeof originalInput;
    // VS Code provides each extension its own API object. Exercise the source
    // flow through this test extension's API, with the installed worker path.
    const extension = vscode.extensions.getExtension('pydemia.commit-defender')!;
    await useAccount(extension.extensionPath, async () => { throw Error('Unexpected sign-in request'); });
    assert.equal(configuration.inspect('aiProvider')?.globalValue, 'codex');
    assert.equal(configuration.inspect('model')?.globalValue, 'gpt-5.6-luna');
    assert.equal(configuration.inspect('reviewReasoningEffort')?.globalValue, 'high');
    assert.equal(observed.length, 3);
    assert.deepEqual(observed[0].labels, ['Codex', 'Claude Code', 'Antigravity']);
    assert(observed[1].labels.includes('GPT-5.6-Luna'));
    assert(observed[2].labels.includes('high'));
    for (const key of ['endpoint', 'modelCredentialRef', 'runOnStage']) assert.deepEqual(configuration.inspect(key)?.globalValue, before[key]);
    const selected = Object.fromEntries(keys.map(key => [key, configuration.inspect(key)?.globalValue]));
    nativeWindow.showQuickPick = (async (items: any) => (await items).find((item: any) => item.provider === 'aoai')) as typeof originalPick;
    nativeWindow.showInputBox = (async () => undefined) as typeof originalInput;
    await useApiCredential();
    assert.deepEqual(Object.fromEntries(keys.map(key => [key, configuration.inspect(key)?.globalValue])), selected);
    return { accountProvider: 'codex', accountModel: 'gpt-5.6-luna', effort: 'high',
      liveAccountCatalog: true, setupFlow: 'source harness with installed catalog worker', nativePickerAnswers: 'scripted', renderedPickerAssertion: false,
      steps: observed, accountModelIdInput: false, apiCancellationPreservedSettings: true,
      realModelGenerationCalls: 0 };
  } finally {
    nativeWindow.showQuickPick = originalPick;
    nativeWindow.showInputBox = originalInput;
    for (const key of keys) await configuration.update(key, before[key], vscode.ConfigurationTarget.Global);
  }
}
