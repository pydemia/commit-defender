import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { CommitDefenderSettings } from '../src/settingsView.js';

/** Read the actual Chromium-rendered DOM in an isolated Extension Host.
 * The observer does not click buttons, use credentials or start reviews. */
export async function checkSettingsRendering() {
  const extension = vscode.extensions.getExtension('pydemia.commit-defender')!;
  const nativeWindow = vscode.window as unknown as { createWebviewPanel: typeof vscode.window.createWebviewPanel };
  const original = nativeWindow.createWebviewPanel;
  const rendered: Array<{ section: string; heading: string; fields: string[]; actions: string[]; status: string }> = [];
  const errors: string[] = [];
  let panel: vscode.WebviewPanel | undefined;
  const view = new CommitDefenderSettings({ extension } as vscode.ExtensionContext);
  nativeWindow.createWebviewPanel = (...args) => {
    panel = original(...args);
    const actual = panel;
    actual.webview.onDidReceiveMessage(message => {
      if (message.type === 'test-settings-dom') rendered.push(message);
      if (message.type === 'test-settings-error') errors.push(message.message);
    });
    const webview = new Proxy(actual.webview, {
      get(target, key) { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
      set(target, key, value) {
        if (key === 'html') {
          const nonce = String(value).match(/<script nonce="([a-f0-9]+)">/)![1];
          const observer = `<script nonce="${nonce}">
            window.addEventListener('error', event => vscode.postMessage({type:'test-settings-error',message:event.message}));
            window.addEventListener('message', event => {
              if(event.data.type !== 'settingsState') return;
              setTimeout(() => vscode.postMessage({type:'test-settings-dom',
                section:document.getElementById('section-title').textContent,
                heading:document.querySelector('h1').textContent,
                fields:Array.from(document.querySelectorAll('#fields input,#fields select,#fields textarea')).map(input => input.name),
                actions:Array.from(document.querySelectorAll('[data-action]')).map(button => button.textContent),
                status:document.getElementById('status').textContent
              }), 0);
            });
          </script>`;
          value = String(value).replace('</body>', observer + '</body>');
        }
        return Reflect.set(target, key, value, target);
      },
    });
    return new Proxy(actual, {
      get(target, key) {
        if (key === 'webview') return webview;
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  try {
    for (const [section, title, field] of [
      ['model', 'Account & Model', 'maxTokens'], ['git', 'Commit Message', 'commitMessageFormat'],
      ['review', 'Review & Display', 'excludePatterns'],
      ['automatic', 'Automatic Reviews', 'runOnSave'], ['knowledge', 'Memory & GCR', 'reviewMode'],
      ['advanced', 'Profiles & Executables', 'localProfile'],
    ]) {
      const count = rendered.length;
      view.open(section);
      const deadline = Date.now() + 15_000;
      while (rendered.length === count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      assert(rendered.length > count, `Chromium did not render ${section}`);
      const current = rendered.at(-1)!;
      assert.equal(current.heading, 'Commit Defender Settings');
      assert.equal(current.section, title); assert(current.fields.includes(field));
      assert(current.actions.includes('VS Code Settings'));
    }
    assert.deepEqual(errors, []);
    assert.equal(rendered[0].actions.filter(label => label === 'Choose model…').length, 3);
    assert(rendered[0].actions.includes('Configure API destination & key…'));
    return { realChromiumDom: true, setupFlow: 'source controller in real Extension Host',
      sections: rendered, scriptErrors: errors, screenshots: false, manualScreenInteraction: false,
      modelGenerationCalls: 0, credentialInputs: 0, settingsWrites: 0 };
  } finally {
    view.dispose(); panel?.dispose(); nativeWindow.createWebviewPanel = original;
  }
}
