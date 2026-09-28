/** The settings page deliberately uses VS Code tokens and no remote assets. */
export function settingsHtml(nonce: string): string {
  return String.raw`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Commit Defender Settings</title>
<style nonce="${nonce}">
* { box-sizing: border-box; }
body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
button,input,select,textarea { font: inherit; }
button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid transparent; border-radius: 3px; padding: 6px 12px; cursor: pointer; }
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: .55; cursor: default; }
:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
header { display: flex; gap: 18px; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--vscode-panel-border); padding: 20px 24px; }
.brand { display: flex; gap: 12px; align-items: center; min-width: 0; }
.brand svg { width: 28px; height: 32px; flex: none; color: var(--vscode-textLink-foreground); }
h1 { font-size: 20px; font-weight: 600; margin: 0 0 5px; }
h2 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
h3 { font-size: 14px; margin: 24px 0 10px; font-weight: 600; }
p { line-height: 1.5; margin: 6px 0 14px; }
.muted,.help { color: var(--vscode-descriptionForeground); }
.help { font-size: 12px; line-height: 1.5; margin: 5px 0 0; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); min-height: calc(100vh - 94px); }
nav { padding: 20px 12px; border-right: 1px solid var(--vscode-panel-border); }
nav button { display: block; width: 100%; text-align: left; padding: 10px 12px; margin: 2px 0; color: var(--vscode-foreground); background: transparent; }
nav button:hover { background: var(--vscode-list-hoverBackground); }
nav button[aria-current="page"] { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.nav-foot { margin: 24px 12px; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
main { min-width: 0; padding: 26px 30px 0; max-width: 1050px; width: 100%; }
#section-description { margin-bottom: 22px; }
.form-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 18px 24px; }
.field { min-width: 0; }
.field.wide { grid-column: 1 / -1; }
label { display: block; font-weight: 600; margin: 0 0 6px; }
input:not([type="checkbox"]),select,textarea { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; padding: 7px 8px; }
textarea { min-height: 85px; resize: vertical; font-family: var(--vscode-editor-font-family); }
.check-label { display: flex; gap: 8px; align-items: center; font-weight: 500; }
input[type="checkbox"] { accent-color: var(--vscode-focusBorder); }
dl { margin: 16px 0; display: grid; grid-template-columns: 130px minmax(0,1fr); gap: 10px 16px; }
dt { color: var(--vscode-descriptionForeground); }
dd { margin: 0; overflow-wrap: anywhere; }
.providers { border-top: 1px solid var(--vscode-panel-border); margin: 16px 0 22px; }
.provider { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 0; border-bottom: 1px solid var(--vscode-panel-border); }
.provider strong { display: block; margin-bottom: 4px; }
.provider .help { margin: 0; }
.provider .actions { justify-content: flex-end; flex-shrink: 0; }
.badge { font-size: 11px; font-weight: 400; margin-left: 8px; color: var(--vscode-descriptionForeground); }
.section-actions { margin: 18px 0 24px; }
.notice { margin: 18px 0; padding-left: 12px; border-left: 2px solid var(--vscode-textLink-foreground); }
#status { min-height: 24px; line-height: 1.5; overflow-wrap: anywhere; margin: 0 0 12px; }
#status.error { color: var(--vscode-errorForeground); }
footer { position: sticky; bottom: 0; background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-panel-border); margin-top: 26px; padding: 14px 0; }
#dirty-count { margin-left: auto; color: var(--vscode-descriptionForeground); }
[hidden] { display: none !important; }
@media(max-width: 760px) { header { flex-wrap: wrap; padding: 16px; } .layout { grid-template-columns: 1fr; } nav { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px 16px; border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); } nav button { width: auto; } .nav-foot { display: none; } main { padding: 20px 16px 0; } .form-grid { grid-template-columns: 1fr; } .provider { align-items: flex-start; flex-wrap: wrap; } }
</style></head><body>
<header><div class="brand"><svg aria-hidden="true" viewBox="0 0 24 28" fill="none"><path d="M12 2 22 6v8c0 6-6 10-10 12C8 24 2 20 2 14V6Z" stroke="currentColor" stroke-width="2"/><path d="m7 13 3 3 7-7" stroke="currentColor" stroke-width="2"/></svg><div><h1>Commit Defender Settings</h1><div class="muted">Accounts, models and local review preferences</div></div></div>
<div class="actions"><button class="secondary" id="refresh">Refresh</button><button class="secondary" data-action="native">VS Code Settings</button><button class="secondary" data-action="guide">Setup Guide</button></div></header>
<div class="layout"><nav aria-label="Settings sections" id="navigation"><div class="nav-foot" id="context"></div></nav>
<main aria-busy="true" id="main"><h2 id="section-title">Loading settings…</h2><p class="muted" id="section-description">Reading Commit Defender User Settings.</p>
<div id="section-content"></div><form id="settings-form"><div class="form-grid" id="fields"></div>
<footer><div role="status" aria-live="polite" id="status">Loading…</div><div class="actions"><button id="save" type="submit" disabled>Save User Settings</button><button id="discard" type="button" class="secondary" disabled>Discard edits</button><span id="dirty-count"></span></div></footer></form>
</main></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const nonce = '${nonce}';
const byId = id => document.getElementById(id);
const restored = vscode.getState() || {};
let state, section = restored.section || 'model', busy = false, stale = false;
let drafts = {}, savedKeys = [];
function node(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; }
function send(message) { vscode.postMessage({ ...message, nonce }); }
function status(text, error = false) { byId('status').textContent = text; byId('status').classList.toggle('error', error); }
function dirtyKeys() { return Object.keys(drafts); }
function controls() {
  const keys = dirtyKeys();
  byId('save').disabled = busy || stale || !state || !keys.some(key => state.fields.find(f => f.key === key).section === section);
  byId('discard').disabled = busy || !keys.length;
  byId('refresh').disabled = busy;
  byId('dirty-count').textContent = keys.length ? keys.length + ' unsaved change' + (keys.length === 1 ? '' : 's') : 'Saved in User Settings';
  byId('main').setAttribute('aria-busy', String(busy));
  document.querySelectorAll('[data-action]').forEach(button => { button.disabled = busy || !!keys.length; });
  document.querySelectorAll('#fields input,#fields select,#fields textarea').forEach(input => { input.disabled = busy; });
}
function actionButton(label, action, provider, primary = false) {
  const button = node('button', label, primary ? '' : 'secondary'); button.type = 'button';
  button.dataset.action = action; if (provider) button.dataset.provider = provider;
  return button;
}
function actions(parent, items) { const row = node('div', undefined, 'actions section-actions'); for (const item of items) row.append(actionButton(...item)); parent.append(row); }
function paragraph(parent, text, cls = 'muted') { parent.append(node('p', text, cls)); }
function variableList(parent, names) {
  const row = node('p', undefined, 'help'); row.append(document.createTextNode('Variables: '));
  names.forEach((name, index) => { if (index) row.append(document.createTextNode(', ')); row.append(node('code', '$' + name)); });
  parent.append(row);
}
function summary(parent, rows) { const dl = node('dl'); for (const [label, value] of rows) { dl.append(node('dt', label), node('dd', value || 'Not configured')); } parent.append(dl); }
function details(parent) {
  if (section === 'model') {
    const rows = [['Provider', state.model.providerLabel], ['Model / deployment', state.model.model], ['Reasoning effort', state.model.effort || 'Provider default'], ['Credential', state.model.credential]];
    if (state.model.provider && !state.providers.some(provider => provider.id === state.model.provider)) rows.push(['API endpoint', state.model.endpoint || 'Provider default']);
    if (state.model.apiVersion) rows.push(['Azure API version', state.model.apiVersion]);
    summary(parent, rows);
    paragraph(parent, state.model.notice, 'notice');
    actions(parent, [['Choose account & model…', 'account', undefined, true], ['Configure API destination & key…', 'api']]);
    const list = node('div', undefined, 'providers');
    for (const provider of state.providers) {
      const row = node('div', undefined, 'provider'), info = node('div');
      const title = node('strong', provider.label); if (state.model.provider === provider.id) title.append(node('span', 'Selected provider', 'badge'));
      info.append(title, node('p', provider.description, 'help'));
      const buttons = node('div', undefined, 'actions');
      buttons.append(actionButton('Choose model…', 'account', provider.id), actionButton('Sign in…', 'signin', provider.id));
      row.append(info, buttons); list.append(row);
    }
    parent.append(list);
    paragraph(parent, 'Account models and supported effort are fetched from the authenticated CLI. API keys are entered in a masked VS Code input and remain in the OS-backed credential store.');
  } else if (section === 'git') {
    paragraph(parent, 'The model returns structured message parts. Commit Defender applies your format afterwards, so literal text and ordering stay deterministic.', 'notice');
    variableList(parent, ['type', 'scope', 'title', 'body', 'branch', 'branchId', 'issueId', 'prId', 'commitId', 'date']);
    paragraph(parent, '$type, $scope, $title and $body come from the generated message. Git variables are resolved locally. $issueId uses the issue number in the current branch; $prId requires a PR/pull marker in the branch name.', 'help');
    actions(parent, [['Generate commit message…', 'commitMessage', undefined, true]]);
  } else if (section === 'review') {
    paragraph(parent, 'Strictness, detail and language apply to the legacy reviewer. Shared-core review criteria come from active Memory, Skills and published GCR guidance.', 'notice');
  } else if (section === 'automatic') {
    paragraph(parent, 'These are global User Settings. Existing worktree overrides remain in effect; manage them separately below. Save applies only changes you make. Commit/Push triggers use advisory background hooks.', 'notice');
    actions(parent, [['Manage this worktree…', 'automatic', undefined, true], ['Review activity', 'activity'], ['Recover interrupted review…', 'recover']]);
    const legacy = node('details'); legacy.append(node('summary', 'Separate legacy blocking pre-commit hook'));
    paragraph(legacy, 'This older hook can block Git on P3 findings. It is independent of the advisory automatic Commit/Push triggers. Hook actions apply to the current repository.');
    actions(legacy, [['Install legacy hook…', 'installHook'], ['Uninstall legacy hook…', 'uninstallHook']]); parent.append(legacy);
  } else if (section === 'knowledge') {
    summary(parent, [['Local profile', state.profile], ['Workspace', state.workspace], ['Default review mode', state.reviewMode]]);
    paragraph(parent, 'Local Memory and Skills are encrypted and scoped to the selected profile/repository/worktree. GCR supplies read-only review knowledge; model execution uses your local account or API credential.');
    actions(parent, [['Local Memory & Skills…', 'knowledge', undefined, true], ['GCR connection & sync…', 'connection'], ['Refresh local history', 'history']]);
    paragraph(parent, 'Connection permissions and worktree overrides are managed by GCR connection & sync. This page does not infer connection or authentication success from saved settings.', 'notice');
  } else {
    paragraph(parent, 'These values are saved in User Settings. Default CLI names use existing executable discovery. A workspace setting cannot select the fixed-source account executor.', 'notice');
    actions(parent, [['Open extension settings', 'native'], ['Open User Settings JSON', 'json']]);
  }
}
function render() {
  const selected = state.sections.find(s => s.id === section) || state.sections[0]; section = selected.id;
  vscode.setState({ section });
  const nav = byId('navigation'); nav.replaceChildren();
  for (const item of state.sections) { const button = node('button', item.label); button.type = 'button'; button.setAttribute('aria-current', item.id === section ? 'page' : 'false'); button.onclick = () => { section = item.id; send({ type: 'section', section }); render(); byId('section-title').focus(); }; nav.append(button); }
  nav.append(node('div', 'Commit Defender ' + state.version + '\nProfile: ' + state.profile, 'nav-foot'));
  byId('section-title').textContent = selected.label; byId('section-title').tabIndex = -1;
  byId('section-description').textContent = selected.description;
  byId('section-content').replaceChildren(); details(byId('section-content'));
  const fields = byId('fields'); fields.replaceChildren();
  for (const field of state.fields.filter(f => f.section === section)) {
    const wrapper = node('div', undefined, 'field' + (field.type === 'array' || field.multiline || field.key.endsWith('Path') || field.type === 'boolean' ? ' wide' : ''));
    const label = node('label', field.label); label.htmlFor = 'field-' + field.key;
    let input;
    if (field.enum) { input = node('select'); field.enum.forEach((value, index) => { const option = node('option', field.enumItemLabels?.[index] || value); option.value = value; input.append(option); }); }
    else if (field.type === 'array' || field.multiline) input = node('textarea');
    else { input = node('input'); input.type = field.type === 'boolean' ? 'checkbox' : ['number','integer'].includes(field.type) ? 'number' : 'text'; }
    input.id = label.htmlFor; input.name = field.key; input.setAttribute('aria-describedby', 'help-' + field.key);
    const value = Object.hasOwn(drafts, field.key) ? drafts[field.key] : field.value;
    if (field.type === 'boolean') { input.checked = value; label.className = 'check-label'; label.prepend(input); wrapper.append(label); }
    else { input.value = Array.isArray(value) ? value.join('\n') : value; wrapper.append(label, input); }
    if (field.minimum !== undefined) input.min = field.minimum;
    if (field.maximum !== undefined) input.max = field.maximum;
    if (field.type === 'number' || field.type === 'integer') { input.step = '1'; input.required = true; }
    if (field.pattern) input.pattern = field.pattern;
    if (field.key.endsWith('Path')) input.required = true;
    const help = node('p', field.help || field.description || '', 'help'); help.id = 'help-' + field.key; wrapper.append(help);
    if (field.override) wrapper.append(node('p', 'Workspace override: ' + field.override + '. Edit it in VS Code Settings.', 'help'));
    input.addEventListener('input', () => {
      const changed = field.type === 'boolean' ? input.checked : field.type === 'array' ? input.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : ['number','integer'].includes(field.type) ? (input.value.trim() ? Number(input.value) : null) : input.value;
      if (JSON.stringify(changed) === JSON.stringify(field.value)) delete drafts[field.key]; else drafts[field.key] = changed;
      controls();
    }); fields.append(wrapper);
  }
  controls();
}
document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-action]'); if (!button || busy) return;
  if (dirtyKeys().length) { status('Save or discard your edits before opening another setup flow.', true); return; }
  busy = true; controls(); status('Opening ' + button.textContent + '…');
  send({ type: 'action', action: button.dataset.action, provider: button.dataset.provider });
});
byId('settings-form').addEventListener('submit', event => {
  event.preventDefault(); if (busy || stale || !state) return;
  const changes = Object.fromEntries(Object.entries(drafts).filter(([key]) => state.fields.find(f => f.key === key).section === section));
  savedKeys = Object.keys(changes); if (!savedKeys.length) return;
  busy = true; controls(); status('Saving User Settings…'); send({ type: 'save', section, revision: state.revision, changes });
});
byId('discard').onclick = () => { drafts = {}; stale = false; send({ type: 'refresh' }); status('Edits discarded.'); if (state) render(); };
byId('refresh').onclick = () => { if (dirtyKeys().length) { status('Discard edits to reload the current User Settings.', true); return; } send({ type: 'refresh' }); };
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'settingsState') {
    if (message.reason === 'saved') { for (const key of savedKeys) delete drafts[key]; savedKeys = []; stale = false; }
    else if (state && state.revision !== message.state.revision && dirtyKeys().length) stale = true;
    state = message.state; if (message.section) section = message.section;
    busy = !!state.busy; render();
    status(stale ? 'Settings changed elsewhere. Your edits are retained; discard them to reload before saving.' : message.notice || 'Ready.', stale);
  } else if (message.type === 'settingsError') { busy = false; if (message.conflict) stale = true; controls(); status(message.notice, true); }
});
send({ type: 'ready' });
</script></body></html>`;
}
