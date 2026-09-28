export const state = {
  values: {} as Record<string, unknown>, workspaceValues: {} as Record<string, unknown>,
  writes: [] as Array<{ key: string; value: unknown; target: number }>,
  commands: [] as Array<{ command: string; args: unknown[] }>, panels: [] as any[],
  listeners: new Set<(event: any) => void>(),
  afterWrite: undefined as ((key: string) => void) | undefined,
  command: undefined as ((command: string) => Promise<void>) | undefined,
  reset() {
    for (const panel of this.panels) panel.dispose();
    this.values = {}; this.workspaceValues = {}; this.writes = []; this.commands = []; this.panels = [];
    this.afterWrite = undefined; this.command = undefined;
  },
};
export const ConfigurationTarget = { Global: 1 };
export const ViewColumn = { Active: -1 };
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export class ThemeIcon { constructor(public id: string) {} }
export class TreeItem { constructor(public label: string, public collapsibleState = 0) {} }
export class EventEmitter<T> {
  event = () => ({ dispose() {} });
  fire(_value: T) {}
}
export const Uri = { file: (fsPath: string) => ({ fsPath }) };
export const extensions = { getExtension: () => undefined };
export const commands = {
  async executeCommand(command: string, ...args: unknown[]) {
    state.commands.push({ command, args }); await state.command?.(command);
  },
};
export const workspace = {
  isTrusted: true,
  workspaceFolders: [{ name: 'fixture workspace', uri: { fsPath: '/fixture' } }],
  getConfiguration: () => ({
    inspect: (key: string) => ({ globalValue: state.values[key], workspaceValue: state.workspaceValues[key] }),
    get: (key: string) => state.workspaceValues[key] ?? state.values[key],
    async update(key: string, value: unknown, target: number) {
      state.writes.push({ key, value, target });
      if (value === undefined) delete state.values[key]; else state.values[key] = value;
      state.afterWrite?.(key);
      state.listeners.forEach(listener => listener({ affectsConfiguration: () => true }));
    },
  }),
  onDidChangeConfiguration(listener: (event: any) => void) {
    state.listeners.add(listener); return { dispose() { state.listeners.delete(listener); } };
  },
};
export const window = {
  createWebviewPanel(viewType: string, title: string, _column: number, options: unknown) {
    let receive: ((message: unknown) => void) | undefined;
    let dispose: (() => void) | undefined;
    const panel = {
      viewType, title, options, disposed: false, reveals: 0, messages: [] as any[],
      webview: {
        html: '',
        onDidReceiveMessage(listener: (message: unknown) => void) {
          receive = listener; return { dispose() { receive = undefined; } };
        },
        async postMessage(message: unknown) { panel.messages.push(message); return true; },
      },
      onDidDispose(listener: () => void) { dispose = listener; return { dispose() { dispose = undefined; } }; },
      reveal() { panel.reveals++; },
      receive(message: unknown) { receive?.(message); },
      dispose() { if (!panel.disposed) { panel.disposed = true; dispose?.(); } },
    };
    state.panels.push(panel); return panel;
  },
};
