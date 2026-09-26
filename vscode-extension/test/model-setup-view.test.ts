import assert from 'node:assert/strict';
import test from 'node:test';
import { state } from './helpers/vscode-model-setup.js';
import { useAccount, useApiCredential } from '../src/modelSetupView.js';

function reset(answers: unknown[]) {
  state.values = { aiProvider: 'codex', model: 'user-model', reviewReasoningEffort: 'high', runOnStage: true,
    localProfile: 'preserved-user', modelCredentialRef: { id: 'preserved-key' } };
  state.answers = [...answers]; state.views = []; state.writes = []; state.notices = [];
}
test('Account entry has exactly the three account providers and cancellation writes nothing', async () => {
  reset([undefined]);
  await useAccount('unused', async () => { throw Error('Unexpected sign in'); });
  assert.deepEqual(state.views[0].items.map((v: any) => v.label), ['Codex', 'Claude Code', 'Antigravity']);
  assert.deepEqual(state.writes, []);
});
for (const cancelledAt of [0, 1, 2, 3, 4, 5]) {
  test(`Azure API setup cancellation at input ${cancelledAt} retains account, model and secret reference`, async () => {
    const inputs = ['Azure OpenAI', 'https://resource.openai.azure.com', 'team-deployment', '2025-01-01-preview', 'gpt-5.5', 'high'];
    reset([...inputs.slice(0, cancelledAt), undefined]);
    await useApiCredential();
    assert.deepEqual(state.writes, []); assert.deepEqual(state.notices, []);
    assert.equal(state.values.aiProvider, 'codex'); assert.equal(state.values.runOnStage, true);
    assert.deepEqual(state.values.modelCredentialRef, { id: 'preserved-key' });
  });
}
test('A known Azure underlying model offers documented effort; deployment ID does not determine it', async () => {
  reset(['Azure OpenAI', 'https://resource.openai.azure.com', 'unrelated-deployment', '2025-01-01-preview', 'gpt-5.5', 'high', undefined]);
  await useApiCredential();
  const picker = state.views.find(view => view.options.title.endsWith('Reasoning effort'));
  assert.deepEqual(picker.items.map((item: any) => item.label), ['Server default', 'none', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(state.writes, []);
});
test('Unknown API capability omits effort, explains default, and masks secret input', async () => {
  reset(['OpenAI / compatible API', 'https://compatible.example/v1', 'custom-model', 'Enter API key…', undefined]);
  await useApiCredential();
  assert(!state.views.some(view => view.options.title.endsWith('Reasoning effort')));
  const key = state.views.find(view => view.options.title.endsWith('· Key'));
  assert(key.options.placeHolder.includes('unknown'));
  const secret = state.views.at(-1);
  assert.equal(secret.options.password, true);
  assert(secret.options.prompt.includes('not a GCR reader key'));
  assert.deepEqual(state.writes, []);
});
