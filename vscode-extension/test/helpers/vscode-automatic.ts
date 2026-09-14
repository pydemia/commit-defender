import path from "node:path";
export const values = {
  global: {} as Record<string, unknown>,
  repository: {} as Record<string, unknown>,
};
function event<T>() {
  const listeners = new Set<(value: T) => unknown>();
  return {
    subscribe: (fn: (value: T) => unknown) => {
      listeners.add(fn);
      return { dispose: () => listeners.delete(fn) };
    },
    fire: (value: T) => {
      for (const listener of [...listeners]) listener(value);
    },
    clear: () => listeners.clear(),
  };
}
export const events = {
  willSave: event<any>(),
  didSave: event<any>(),
  change: event<any>(),
  folders: event<any>(),
  trust: event<any>(),
  config: event<any>(),
  focus: event<any>(),
};
export class Uri {
  scheme = "file";
  constructor(readonly fsPath: string) {}
  static file(p: string) {
    return new Uri(p);
  }
  toString() {
    return `file://${this.fsPath}`;
  }
}
export class RelativePattern {
  constructor(
    readonly baseUri: Uri,
    readonly pattern: string,
  ) {}
}
export const watchers: Array<{
  pattern: RelativePattern;
  change: ReturnType<typeof event<Uri>>;
  create: ReturnType<typeof event<Uri>>;
  delete: ReturnType<typeof event<Uri>>;
  disposed: boolean;
}> = [];
export const workspace = {
  isTrusted: true,
  workspaceFolders: [] as Array<{ uri: Uri }>,
  textDocuments: [] as any[],
  getWorkspaceFolder: (uri: Uri) =>
    workspace.workspaceFolders.find(
      (f) =>
        uri.fsPath === f.uri.fsPath ||
        uri.fsPath.startsWith(f.uri.fsPath + path.sep),
    ),
  getConfiguration: () => ({
    inspect: (key: string) => ({
      globalValue: values.global[key],
      workspaceValue: values.repository[key],
    }),
    get: (key: string) => values.repository[key] ?? values.global[key],
    update: async (key: string, value: unknown) => {
      values.global[key] = value;
      events.config.fire({
        affectsConfiguration: (k: string) => k === `commitDefender.${key}`,
      });
    },
  }),
  onWillSaveTextDocument: events.willSave.subscribe,
  onDidSaveTextDocument: events.didSave.subscribe,
  onDidChangeTextDocument: events.change.subscribe,
  onDidChangeWorkspaceFolders: events.folders.subscribe,
  onDidGrantWorkspaceTrust: events.trust.subscribe,
  onDidChangeConfiguration: events.config.subscribe,
  createFileSystemWatcher: (pattern: RelativePattern) => {
    const row = {
      pattern,
      change: event<Uri>(),
      create: event<Uri>(),
      delete: event<Uri>(),
      disposed: false,
    };
    watchers.push(row);
    return {
      onDidChange: row.change.subscribe,
      onDidCreate: row.create.subscribe,
      onDidDelete: row.delete.subscribe,
      dispose: () => {
        row.disposed = true;
        row.change.clear();
        row.create.clear();
        row.delete.clear();
      },
    };
  },
};
export const window = {
  onDidChangeWindowState: events.focus.subscribe,
  showQuickPick: async () => undefined,
};
export const commands = { registerCommand: () => ({ dispose: () => {} }) };
export const extensions = { getExtension: () => undefined };
export const TextDocumentSaveReason = { Manual: 1, AfterDelay: 2, FocusOut: 3 };
export const ConfigurationTarget = { Global: 1 };
export function reset() {
  values.global = {};
  values.repository = {};
  workspace.workspaceFolders = [];
  workspace.textDocuments = [];
  workspace.isTrusted = true;
  watchers.length = 0;
  for (const e of Object.values(events)) e.clear();
}
