import { createHash, randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { captureModelSettings, type ModelSettingsPort } from './modelSetupSettings.js';
import { holdModelConfiguration, waitForModelConfiguration } from './config.js';
import { settingsHtml } from './settingsHtml.js';
import { isSettingsSection, settingsFields, settingsSections, validateSettingsChanges,
  type SettingsDefinitions, type SettingsSection } from './settingsSchema.js';

const accountProviders = [
  { id: 'codex', label: 'Codex', description: 'Existing ChatGPT / Codex CLI account', signIn: 'commitDefender.signInCodex' },
  { id: 'claudecode', label: 'Claude Code', description: 'Existing Claude Code subscription login', signIn: 'commitDefender.signInClaudeCode' },
  { id: 'antigravity', label: 'Antigravity', description: 'Existing account in the standalone agy CLI', signIn: 'commitDefender.signInAntigravity' },
];
const providerLabels: Record<string, string> = {
  codex: 'Codex account', claudecode: 'Claude Code account', antigravity: 'Antigravity account',
  aoai: 'Azure OpenAI API', openai: 'OpenAI / compatible API', anthropic: 'Anthropic API', gemini: 'Gemini API',
};
const actionCommands: Record<string, string> = {
  api: 'commitDefender.manageModelCredential', automatic: 'commitDefender.manageAutomaticReviews',
  knowledge: 'commitDefender.manageLocalKnowledge', connection: 'commitDefender.manageCentralConnection',
  activity: 'commitDefender.localReviewActivity', history: 'commitDefender.refreshLocalHistory',
  recover: 'commitDefender.recoverBackgroundReview', installHook: 'commitDefender.installPreCommitHook',
  uninstallHook: 'commitDefender.uninstallPreCommitHook',
  commitMessage: 'commitDefender.generateCommitMessage',
  native: 'commitDefender.openNativeSettings', json: 'workbench.action.openSettingsJson',
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Legacy endpoint values can contain credentials; never send them to the webview. */
function displayEndpoint(value: unknown): string {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    if (!['https:', 'http:'].includes(url.protocol)) return 'Invalid endpoint (check VS Code Settings)';
    return url.origin + url.pathname;
  } catch { return 'Invalid endpoint (check VS Code Settings)'; }
}

/** One named settings editor. CLI auth and credential writes remain native command flows. */
export class CommitDefenderSettings implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private listeners: vscode.Disposable[] = [];
  private nonce = '';
  private section: SettingsSection = 'model';
  private busy = false;
  private disposed = false;
  private readonly definitions: SettingsDefinitions;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.definitions = context.extension.packageJSON.contributes.configuration.properties;
  }
  open(section?: unknown): void {
    if (this.disposed) return;
    if (isSettingsSection(section)) this.section = section;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      if (!this.busy) this.publish('', 'refresh', this.section);
      return;
    }
    const panel = vscode.window.createWebviewPanel('commitDefender.settings', 'Commit Defender Settings',
      vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    this.panel = panel;
    this.nonce = randomBytes(16).toString('hex');
    panel.webview.html = settingsHtml(this.nonce);
    this.listeners.push(
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.listeners.splice(0).forEach(listener => listener.dispose());
      }),
      panel.webview.onDidReceiveMessage(message => { void this.receive(message); }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (!this.busy && event.affectsConfiguration('commitDefender')) this.publish();
      }),
    );
  }
  private port(): ModelSettingsPort {
    return {
      read: key => vscode.workspace.getConfiguration('commitDefender').inspect(key)?.globalValue,
      write: async (key, value) => {
        await vscode.workspace.getConfiguration('commitDefender').update(key, value, vscode.ConfigurationTarget.Global);
      },
    };
  }
  private snapshot(): Record<string, unknown> {
    const port = this.port();
    return { ...captureModelSettings(port), ...Object.fromEntries(settingsFields.map(field => [field.key, port.read(field.key)])) };
  }
  private revision(snapshot = this.snapshot()): string {
    return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  }
  private publish(notice = '', reason = 'refresh', section?: SettingsSection): void {
    if (!this.panel) return;
    const snapshot = this.snapshot();
    const cfg = vscode.workspace.getConfiguration('commitDefender', vscode.workspace.workspaceFolders?.[0]?.uri);
    const provider = String(snapshot.aiProvider ?? '');
    const account = accountProviders.some(item => item.id === provider);
    const reference = snapshot.modelCredentialRef as { version?: number; id?: string } | undefined;
    const fields = settingsFields.map(field => {
      const spec = this.definitions[`commitDefender.${field.key}`];
      const inspect = cfg.inspect(field.key);
      const override = spec.scope === 'application' ? undefined : inspect?.workspaceFolderValue ?? inspect?.workspaceValue;
      return { ...spec, ...field, value: snapshot[field.key] ?? spec.default,
        maximum: field.key.endsWith('TimeoutSeconds') ? 600 : spec.maximum,
        override: override === undefined ? undefined : JSON.stringify(override) };
    });
    void this.panel.webview.postMessage({ type: 'settingsState', notice, reason, section,
      state: {
        revision: this.revision(snapshot), version: this.context.extension.packageJSON.version, busy: this.busy,
        sections: settingsSections, fields,
        profile: String(snapshot.localProfile ?? 'default'), reviewMode: String(snapshot.reviewMode ?? 'standalone'),
        workspace: vscode.workspace.workspaceFolders?.map(folder => folder.name).join(', ') || 'No workspace open',
        providers: accountProviders.map(({ signIn: _, ...provider }) => provider),
        model: {
          provider, providerLabel: providerLabels[provider] ?? 'Not configured', model: String(snapshot.model ?? ''),
          effort: String(snapshot.reviewReasoningEffort ?? (provider === 'codex' ? 'xhigh' : '')),
          endpoint: account ? '' : displayEndpoint(snapshot.endpoint),
          apiVersion: provider === 'aoai' ? String(snapshot.apiVersion ?? '2024-08-01-preview') : '',
          credential: account ? 'CLI-owned login; current status not checked here'
            : reference?.version === 1 && reference.id ? 'OS-backed reference configured; checked when review runs' : 'No OS-backed API credential selected',
          notice: !provider || !snapshot.model ? 'Choose an account and model or configure an API destination to start reviewing.'
            : 'Saved selection. Choosing an account model verifies its CLI login. Opening Settings does not recheck login or contact a model.',
        },
      },
    });
  }
  private async receive(message: unknown): Promise<void> {
    if (this.disposed || !this.panel || !message || typeof message !== 'object') return;
    const data = message as Record<string, unknown>;
    if (data.nonce !== this.nonce) return;
    if (data.type === 'section' && isSettingsSection(data.section)) { this.section = data.section; return; }
    if (data.type === 'ready' || data.type === 'refresh') {
      this.publish('', 'refresh', data.type === 'ready' ? this.section : undefined);
      return;
    }
    if (this.busy) return;
    if (data.type !== 'save' && data.type !== 'action') return;
    this.busy = true;
    let notice = '', reason = 'refresh', failure = '', conflict = false;
    const requestingPanel = this.panel;
    try {
      if (data.type === 'save') {
        const values = validateSettingsChanges(data.changes, data.section, this.definitions);
        await waitForModelConfiguration();
        if (this.disposed || this.panel !== requestingPanel) return;
        const snapshot = this.snapshot();
        if (data.revision !== this.revision(snapshot)) throw Error('configuration-changed');
        await this.save(snapshot, values);
        notice = 'User Settings saved.'; reason = 'saved';
      } else {
        await this.action(data);
        notice = 'Setup flow closed. Current saved settings are shown.';
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      conflict = code === 'configuration-changed';
      failure = code === 'configuration-changed'
        ? 'Settings changed elsewhere. Your edits were not saved. Discard edits to reload before retrying.'
        : code === 'invalid-settings' || code === 'invalid-action'
          ? 'Invalid settings request. Check the values and try again.'
          : 'The operation could not be completed. Check VS Code Settings and try again. Your edits are retained.';
    } finally {
      this.busy = false;
      if (failure) void this.panel?.webview.postMessage({ type: 'settingsError', notice: failure, conflict });
      else this.publish(notice, reason);
    }
  }
  private async save(snapshot: Record<string, unknown>, values: Record<string, unknown>): Promise<void> {
    const port = this.port();
    const expected = { ...snapshot };
    const written: string[] = [];
    const unchanged = () => Object.keys(expected).every(key => same(port.read(key), expected[key]));
    const release = holdModelConfiguration(snapshot);
    try {
      for (const [key, value] of Object.entries(values)) {
        if (!unchanged()) throw Error('configuration-changed');
        await port.write(key, value); written.push(key); expected[key] = value;
        if (!unchanged()) throw Error('configuration-changed');
      }
    } catch (error) {
      for (const key of written.reverse()) {
        if (same(port.read(key), expected[key])) await port.write(key, snapshot[key]);
      }
      throw error;
    } finally { release(); }
  }
  private async action(data: Record<string, unknown>): Promise<void> {
    const provider = accountProviders.find(item => item.id === data.provider);
    if (data.action === 'account') {
      if (data.provider !== undefined && !provider) throw Error('invalid-action');
      await vscode.commands.executeCommand('commitDefender.selectAccountProviderAndModel', provider?.id);
    } else if (data.action === 'signin' && provider) {
      await vscode.commands.executeCommand(provider.signIn);
    } else {
      const command = typeof data.action === 'string' && Object.hasOwn(actionCommands, data.action) ? actionCommands[data.action] : undefined;
      if (!command) throw Error('invalid-action');
      await vscode.commands.executeCommand(command);
    }
  }
  dispose(): void {
    this.disposed = true;
    this.panel?.dispose();
    this.listeners.splice(0).forEach(listener => listener.dispose());
  }
}
