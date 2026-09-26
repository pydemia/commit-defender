import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCodexModels, parseClaudeModels, parseAntigravityModels, loadAccountModels, accountEnvironment } from '../src/accountModelCatalog.js';
import { captureModelSettings, commitModelSettings, type ModelSettingsPort } from '../src/modelSetupSettings.js';
import { apiReasoningEfforts } from '../src/apiModelCapabilities.js';

test('Codex choices come from the account catalog and intersect fixed-source effort support', () => {
  const result = parseCodexModels([{ model: 'returned-model', displayName: 'Returned model',
    supportedReasoningEfforts: [{ reasoningEffort: 'high' }, { reasoningEffort: 'ultra' }, { reasoningEffort: 'max' }],
    defaultReasoningEffort: 'ultra' }, { model: 'hidden', hidden: true }]);
  assert.deepEqual(result.map(m => [m.id, m.efforts, m.defaultEffort]), [['returned-model', ['high'], 'high']]);
  assert.throws(() => parseCodexModels([{ model: 'injected\nmodel' }]), /invalid-catalog/);
});
test('Claude unsupported effort stays unavailable; exact account aliases and max are retained', () => {
  assert.deepEqual(parseClaudeModels([{ value: 'haiku' }, { value: 'opus[1m]', supportsEffort: true,
    supportedEffortLevels: ['high', 'xhigh', 'max', 'invented'] }]).map(m => [m.id, m.efforts]),
    [['haiku', []], ['opus[1m]', ['high', 'xhigh', 'max']]]);
});
test('Antigravity groups only actual returned effort variants and preserves unvariant models', () => {
  const models = parseAntigravityModels('Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n');
  assert.equal(models.length, 2);
  assert.deepEqual(models[0].efforts, ['high', 'low']);
  assert.equal(models[0].variants?.medium, undefined);
  assert.equal(models[0].variants?.low, 'gemini-3.8-flash-low');
  assert.deepEqual(models[1].efforts, []);
});
test('Account discovery has no source/prompt inputs, API-key fallback or repository executable resolution', async () => {
  const calls: any[] = [];
  const result = await loadAccountModels('claudecode', process.execPath, { workerPath: 'unused', run: async input => {
    calls.push(input);
    return { code: 0, stderr: '', stdout: calls.length === 1
      ? JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })
      : [{ type: 'control_response', response: { subtype: 'success', request_id: 'cd-models', response: { models: [{ value: 'haiku' }] } } },
        { type: 'control_response', response: { subtype: 'success', request_id: 'cd-connection', response: { rate_limits_available: true } } }].map(v => JSON.stringify(v)).join('\n') };
  } });
  assert.equal(result[0].id, 'haiku');
  assert(calls[1].args.includes('--safe-mode')); assert(calls[1].args.includes('--no-session-persistence'));
  assert(!calls[1].stdin.includes('"type":"user"'));
  assert.equal(accountEnvironment('claudecode').ANTHROPIC_API_KEY, undefined);
  await assert.rejects(loadAccountModels('codex', 'repository-command', { workerPath: 'unused' }), /cli-unavailable/);
});
test('Missing subscription auth and failed live validation never expose a fallback catalog', async () => {
  await assert.rejects(loadAccountModels('claudecode', process.execPath, { workerPath: 'unused', run: async () =>
    ({ code: 0, stderr: '', stdout: JSON.stringify({ loggedIn: true, authMethod: 'api_key' }) }) }), /auth-unavailable/);
  await assert.rejects(loadAccountModels('antigravity', process.execPath, { workerPath: 'unused', run: async () =>
    ({ code: 0, stderr: '', stdout: 'No connection' }) }), /catalog-unavailable/);
});
test('API capabilities do not guess support from deployment names or unsupported adapters', () => {
  assert.deepEqual(apiReasoningEfforts('aoai', 'team-prod-reasoning'), []);
  assert.deepEqual(apiReasoningEfforts('openai', 'gpt-5.5'), ['none', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(apiReasoningEfforts('anthropic', 'claude-opus-5'), []);
  assert.deepEqual(apiReasoningEfforts('gemini', 'gemini-3.8-flash'), []);
  assert.deepEqual(apiReasoningEfforts('openai', 'gpt-5-pro'), []);
});
function settings(initial: Record<string, unknown>) {
  const values = { ...initial }; const writes: string[] = [];
  const port: ModelSettingsPort = { read: key => values[key], write: async (key, value) => { values[key] = value; writes.push(key); } };
  return { values, writes, port };
}
test('Completed draft commits provider last and retains unrelated settings/credentials', async () => {
  const s = settings({ aiProvider: 'openai', model: 'old', runOnStage: true, modelCredentialRef: { id: 'existing' } });
  await commitModelSettings(s.port, captureModelSettings(s.port), { aiProvider: 'claudecode', model: 'haiku', reviewReasoningEffort: '' });
  assert.equal(s.writes.at(-1), 'aiProvider'); assert.equal(s.values.runOnStage, true);
  assert.deepEqual(s.values.modelCredentialRef, { id: 'existing' });
});
test('A settings write failure rolls back this draft without erasing a concurrent user edit', async () => {
  const s = settings({ aiProvider: 'codex', model: 'old', reviewReasoningEffort: 'high' });
  const snapshot = captureModelSettings(s.port);
  const write = s.port.write;
  s.port.write = async (key, value) => {
    if (key === 'reviewReasoningEffort' && value === 'low') { s.values.model = 'user-edit'; throw Error('write-failed'); }
    await write(key, value);
  };
  await assert.rejects(commitModelSettings(s.port, snapshot, { model: 'new', reviewReasoningEffort: 'low', aiProvider: 'claudecode' }), /write-failed/);
  assert.equal(s.values.model, 'user-edit'); assert.equal(s.values.aiProvider, 'codex');
});
test('Changing profile while the picker is open prevents committing the draft', async () => {
  const s = settings({ localProfile: 'one', aiProvider: 'codex', model: 'old' });
  const snapshot = captureModelSettings(s.port); s.values.localProfile = 'two';
  await assert.rejects(commitModelSettings(s.port, snapshot, { model: 'new', aiProvider: 'claudecode' }), /configuration-changed/);
  assert.deepEqual(s.writes, []);
});
