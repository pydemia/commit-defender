import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Script } from 'node:vm';
import type { ExtensionContext } from 'vscode';
import { state, ConfigurationTarget } from './helpers/vscode-settings.js';
import { CommitDefenderSettings } from '../src/settingsView.js';
import { getConfig, holdModelConfiguration } from '../src/config.js';
import { HistoryProvider } from '../src/historyProvider.js';
import { validateSettingsChanges, settingsFields } from '../src/settingsSchema.js';

const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const definitions = manifest.contributes.configuration.properties;
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  state.reset();
  state.values = { aiProvider: 'codex', model: 'chosen-model', localProfile: 'ui-fixture', runOnSave: false,
    reviewReasoningEffort: 'high', apiKey: 'never-export-plaintext', endpoint: 'https://user:password@example.test/v1?key=never-export-query#secret' };
  const context = { extension: { packageJSON: manifest }, subscriptions: [] } as unknown as ExtensionContext;
  const view = new CommitDefenderSettings(context);
  view.open();
  const panel = state.panels[0];
  const nonce = panel.webview.html.match(/const nonce = '([a-f0-9]+)'/)[1];
  const send = async (message: unknown) => { panel.receive({ nonce, ...(message as object) }); await tick(); };
  return { view, panel, send, latest: () => panel.messages.at(-1), nonce };
}
test('Settings opens with a product title, valid script, no network assets, no secret export and one editor', async t => {
  const f = setup(); t.after(() => f.view.dispose());
  assert.equal(f.panel.title, 'Commit Defender Settings');
  assert.equal(f.panel.options.enableScripts, true);
  assert.deepEqual(f.panel.options.localResourceRoots, []);
  assert(f.panel.webview.html.includes('Sign in / switch…'));
  assert(!f.panel.webview.html.includes('Setup Guide'));
  new Script(f.panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1]);
  await f.send({ type: 'ready' });
  const snapshot = f.latest().state;
  assert.equal(snapshot.model.model, 'chosen-model');
  assert(!JSON.stringify(snapshot).includes('never-export'));
  assert(!JSON.stringify(snapshot).includes('password'));
  assert.equal(state.commands.length, 0); assert.equal(state.writes.length, 0);
  f.view.open('review'); f.view.open('advanced');
  assert.equal(state.panels.length, 1); assert.equal(f.panel.reveals, 2);
  assert.equal(f.latest().section, 'advanced');
  await f.send({ type: 'section', section: 'knowledge' });
  f.view.open(); assert.equal(f.latest().section, 'knowledge');
  assert.equal(state.listeners.size, 1);
  f.panel.dispose(); assert.equal(state.listeners.size, 0);
  f.view.open('automatic'); assert.equal(state.panels.length, 2);
});
test('An active native setup serializes actions, reports failure without secret echoes and releases the UI', async t => {
  const f = setup(); t.after(() => f.view.dispose());
  let complete!: () => void;
  state.command = () => new Promise<void>(resolve => { complete = resolve; });
  await f.send({ type: 'action', action: 'api' });
  await f.send({ type: 'action', action: 'connection' });
  await f.send({ type: 'ready' });
  assert.equal(f.latest().state.busy, true); assert.equal(state.commands.length, 1);
  complete(); await tick(); assert.equal(f.latest().state.busy, false);
  state.command = async () => { throw Error('never-export-error-key'); };
  await f.send({ type: 'action', action: 'api' });
  assert.equal(f.latest().type, 'settingsError');
  assert(!JSON.stringify(f.latest()).includes('never-export-error-key'));
  await f.send({ type: 'refresh' }); assert.equal(f.latest().state.busy, false);
});
test('API summary redacts legacy URL credentials and describes a reference without claiming verified access', async t => {
  const f = setup(); t.after(() => f.view.dispose());
  state.values.aiProvider = 'openai'; state.values.modelCredentialRef = { version: 1, id: 'private-reference', profileId: 'ui-fixture' };
  await f.send({ type: 'ready' });
  assert.equal(f.latest().state.model.endpoint, 'https://example.test/v1');
  assert(f.latest().state.model.credential.includes('checked when review runs'));
  assert(!JSON.stringify(f.latest()).includes('private-reference'));
});
test('Saves only validated changed keys to User Settings; does not turn on other triggers or change the model', async t => {
  const f = setup(); t.after(() => f.view.dispose());
  await f.send({ type: 'ready' });
  await f.send({ type: 'save', section: 'automatic', revision: f.latest().state.revision,
    changes: { runOnSave: true, automaticSaveIntervalSeconds: 120 } });
  assert.equal(f.latest().reason, 'saved');
  assert.deepEqual(state.writes.map(w => w.key), ['runOnSave', 'automaticSaveIntervalSeconds']);
  assert(state.writes.every(w => w.target === ConfigurationTarget.Global));
  assert.equal(state.values.aiProvider, 'codex'); assert.equal(state.values.model, 'chosen-model');
  assert.equal(state.values.runOnCommit, undefined); assert.equal(state.values.apiKey, 'never-export-plaintext');
});
test('Commit message format saves multiline dollar-variable templates and rejects unknown variables', async t => {
  const f = setup(); t.after(() => f.view.dispose()); await f.send({ type: 'ready' });
  const format = '$type($scope): $title\n\n$body\n\nRefs #$issueId';
  await f.send({ type: 'save', section: 'git', revision: f.latest().state.revision,
    changes: { commitMessageFormat: format } });
  assert.equal(f.latest().reason, 'saved');
  assert.equal(state.values.commitMessageFormat, format);
  const revision = f.latest().state.revision;
  await f.send({ type: 'save', section: 'git', revision,
    changes: { commitMessageFormat: '$unknown $title' } });
  assert.equal(f.latest().type, 'settingsError');
  assert.equal(state.values.commitMessageFormat, format);
});
test('Rejects secrets, model text, hook policy, invalid types/ranges, wrong sections and forged nonce before writing', async t => {
  const f = setup(); t.after(() => f.view.dispose()); await f.send({ type: 'ready' });
  const revision = f.latest().state.revision;
  for (const changes of [{ apiKey: 'key' }, { model: 'unverified' }, { preCommitHook: 'enable' },
    { runOnSave: 'yes' }, { automaticReviewsPerHour: 0 }, { automaticSaveIntervalSeconds: NaN },
    { automaticSaveIntervalSeconds: 10.5 }, { locale: 'ko' }]) {
    await f.send({ type: 'save', section: 'automatic', revision, changes });
    assert.equal(f.latest().type, 'settingsError');
  }
  f.panel.receive({ nonce: 'forged', type: 'save', section: 'automatic', revision, changes: { runOnSave: true } });
  await tick(); assert.equal(state.writes.length, 0);
  for (const field of settingsFields) assert(definitions['commitDefender.' + field.key], field.key);
  assert.throws(() => validateSettingsChanges({ fileTimeoutSeconds: 601 }, 'review', definitions));
  assert.throws(() => validateSettingsChanges({ excludePatterns: ['ok', 'bad\npattern'] }, 'review', definitions));
  assert.throws(() => validateSettingsChanges({ localProfile: '../escape' }, 'advanced', definitions));
});
test('Concurrent edits are preserved; a stale revision cannot overwrite another user change', async t => {
  const f = setup(); t.after(() => f.view.dispose()); await f.send({ type: 'ready' });
  const revision = f.latest().state.revision;
  state.values.runOnSave = true;
  await f.send({ type: 'save', section: 'automatic', revision, changes: { runOnSave: false } });
  assert.equal(f.latest().type, 'settingsError'); assert.equal(f.latest().conflict, true);
  assert.equal(state.values.runOnSave, true); assert.equal(state.writes.length, 0);
  await f.send({ type: 'refresh' });
  state.afterWrite = key => { if (key === 'runOnSave') state.values.model = 'changed-in-another-window'; };
  await f.send({ type: 'save', section: 'automatic', revision: f.latest().state.revision,
    changes: { runOnSave: false, automaticReviewsPerHour: 10 } });
  assert.equal(state.values.runOnSave, true);
  assert.equal(state.values.model, 'changed-in-another-window');
  assert.equal(state.values.automaticReviewsPerHour, undefined);
});
test('Closing the editor while model setup holds config cancels a pending settings save', async t => {
  const f = setup(); t.after(() => f.view.dispose()); await f.send({ type: 'ready' });
  const release = holdModelConfiguration({ ...state.values });
  try {
    await f.send({ type: 'save', section: 'automatic', revision: f.latest().state.revision, changes: { runOnSave: true } });
    f.panel.dispose(); f.view.open();
  } finally { release(); }
  await tick(); assert.equal(state.writes.length, 0);
  assert.equal(state.panels[1].messages.at(-1).state.busy, false);
});
test('Model, credential, knowledge and connection actions reuse allowlisted existing commands', async t => {
  const f = setup(); t.after(() => f.view.dispose());
  for (const action of [
    { action: 'account', provider: 'codex' }, { action: 'signin', provider: 'claudecode' }, { action: 'api' },
    { action: 'connection' }, { action: 'knowledge' }, { action: 'automatic' }, { action: 'native' },
  ]) await f.send({ type: 'action', ...action });
  assert.deepEqual(state.commands.map(c => c.command), [
    'commitDefender.selectAccountProviderAndModel', 'commitDefender.signInClaudeCode', 'commitDefender.manageModelCredential',
    'commitDefender.manageCentralConnection', 'commitDefender.manageLocalKnowledge', 'commitDefender.manageAutomaticReviews', 'commitDefender.openNativeSettings',
  ]);
  assert.deepEqual(state.commands[0].args, ['codex']);
  for (const action of [{ action: 'workbench.action.terminal.new' }, { action: '__proto__' }, { action: 'signin', provider: 'openai' }, { action: 'account', provider: 'invalid' }]) {
    await f.send({ type: 'action', ...action }); assert.equal(f.latest().type, 'settingsError');
  }
  assert.equal(state.commands.length, 7); assert.equal(state.writes.length, 0);
});
test('Side Panel and Command Palette settings entry points lead to named settings sections', () => {
  state.reset(); const tree = new HistoryProvider(getConfig());
  const root = tree.getChildren();
  const settings = root.find(n => n.id === 'sec-settings')!;
  const item = tree.getTreeItem(settings); assert.equal(item.label, 'Settings & Connections');
  assert.equal(item.collapsibleState, 2);
  for (const id of ['cfg-provider', 'cfg-model']) {
    const node = tree.getChildren(settings).find(n => n.id === id)!;
    assert.equal(tree.getTreeItem(node).command?.command, 'commitDefender.openModelSettings');
  }
  assert(!tree.getChildren(settings).some(n => tree.getTreeItem(n).command?.command === 'workbench.action.openSettings'));
  for (const suffix of ['openSettings', 'openModelSettings', 'openCommitSettings', 'openReviewSettings', 'openAutomaticSettings', 'openKnowledgeSettings', 'openAdvancedSettings', 'openNativeSettings']) {
    const command = 'commitDefender.' + suffix;
    assert(manifest.contributes.commands.some((c: any) => c.command === command));
    assert(manifest.contributes.menus.commandPalette.some((c: any) => c.command === command && c.when !== 'false'));
  }
});
