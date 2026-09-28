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
  const settingsTabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs)
    .filter(t => t.label === 'Commit Defender Settings');
  await vscode.commands.executeCommand('commitDefender.openConnectionGuide', process.env.CD_GUIDE_INSPECT_LANGUAGE || 'en');
  if (process.env.CD_GUIDE_INSPECT === '1') {
    fs.writeFileSync(process.env.CD_GUIDE_READY, 'ready');
    const deadline = Date.now() + 15 * 60_000;
    while (!fs.existsSync(process.env.CD_GUIDE_CONTINUE)) {
      assert(Date.now() < deadline, 'UI inspection deadline exceeded');
      await new Promise(r => setTimeout(r, 500));
    }
  }
  const observed = [];
  for (const language of [undefined, 'ko', 'en']) {
    await vscode.commands.executeCommand('commitDefender.openConnectionGuide', language);
    for (let attempt = 0; attempt < 40 && settingsTabs().length === 0; attempt++) {
      await new Promise(r => setTimeout(r, 50));
    }
    observed.push({ requested: language ?? 'display-language', tabs: tabs() });
    const settings = settingsTabs();
    assert.equal(settings.length, 1, 'Connection command must reuse one Commit Defender Settings tab');
    assert(settings[0].input instanceof vscode.TabInputWebview);
    assert(!tabs().some(t => /^(Welcome|Get Started)$/.test(t.label)),
      'Connection command must not open the VS Code Welcome tab');
  }
  const observedTabs = tabs();
  assert(observedTabs.some(t => t.label === 'Commit Defender Settings'));
  assert.equal(JSON.stringify(vscode.workspace.getConfiguration('commitDefender')), config);
  fs.writeFileSync(process.env.CD_GUIDE_PROOF, JSON.stringify({
    version: ext.packageJSON.version, vscodeVersion: vscode.version,
    delivery: process.env.CD_GUIDE_DELIVERY, realExtensionHost: true,
    displayLanguage: vscode.env.language, connectionSettingsCommands: observed,
    settingsTabs: observedTabs, modelCalls: 0, centralConnections: 0, settingsUnchanged: true,
    configurationHash: crypto.createHash('sha256').update(config).digest('hex'),
    renderedContentEvidence: 'See the separate UI inspection record; tab creation alone is not rendering evidence.',
  }, null, 2) + '\n');
};
