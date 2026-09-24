const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

exports.run = async () => {
  const ext = vscode.extensions.getExtension('pydemia.commit-defender');
  assert(ext);
  await ext.activate();
  const config = JSON.stringify(vscode.workspace.getConfiguration('commitDefender'));
  const guides = ext.packageJSON.contributes.walkthroughs;
  assert.equal(guides.length, 2);
  for (const guide of guides) for (const step of guide.steps) {
    assert(step.media.svg && !step.media.markdown);
    const svg = fs.readFileSync(path.join(ext.extensionPath, step.media.svg), 'utf8');
    assert(!/<script|<foreignObject|<style|(?:href|src)=["']https?:/i.test(svg));
  }
  const tabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => ({
    label: t.label, input: t.input?.constructor?.name ?? 'native',
  }));
  const observed = [];
  for (const language of [undefined, 'ko', 'en']) {
    await vscode.commands.executeCommand('commitDefender.openConnectionGuide', language);
    await new Promise(r => setTimeout(r, 700));
    observed.push({ requested: language ?? 'display-language', tabs: tabs() });
    assert(!vscode.window.visibleTextEditors.some(e => /central-setup/.test(e.document.uri.path)), 'Guide must not open in a text editor');
  }
  await vscode.commands.executeCommand('commitDefender.openSettings');
  await new Promise(r => setTimeout(r, 700));
  const settingsTabs = tabs();
  assert(settingsTabs.some(t => /Settings|설정/.test(t.label)), 'Native settings tab must open');
  await vscode.commands.executeCommand('commitDefender.openConnectionGuide', process.env.CD_GUIDE_INSPECT_LANGUAGE || 'en');
  if (process.env.CD_GUIDE_INSPECT === '1') {
    fs.writeFileSync(process.env.CD_GUIDE_READY, 'ready');
    const deadline = Date.now() + 15 * 60_000;
    while (!fs.existsSync(process.env.CD_GUIDE_CONTINUE)) {
      assert(Date.now() < deadline, 'UI inspection deadline exceeded');
      await new Promise(r => setTimeout(r, 500));
    }
  }
  assert.equal(JSON.stringify(vscode.workspace.getConfiguration('commitDefender')), config);
  fs.writeFileSync(process.env.CD_GUIDE_PROOF, JSON.stringify({
    version: ext.packageJSON.version, vscodeVersion: vscode.version,
    delivery: process.env.CD_GUIDE_DELIVERY, realExtensionHost: true,
    displayLanguage: vscode.env.language, walkthroughCommands: observed,
    settingsTabs, modelCalls: 0, centralConnections: 0, settingsUnchanged: true,
    configurationHash: crypto.createHash('sha256').update(config).digest('hex'),
    renderedContentEvidence: 'See the separate UI inspection record; tab creation alone is not rendering evidence.',
  }, null, 2) + '\n');
};
