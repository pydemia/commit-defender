export const state = { values: {} as Record<string, unknown>, answers: [] as unknown[], views: [] as any[], writes: [] as any[], notices: [] as string[] };
export const ConfigurationTarget = { Global: 1 };
export const ProgressLocation = { Notification: 1 };
export const Uri = { file: (fsPath: string) => ({ fsPath }) };
export const extensions = { getExtension: () => undefined };
export const workspace = {
  isTrusted: true,
  getConfiguration: () => ({
    inspect: (key: string) => ({ globalValue: state.values[key] }),
    get: (key: string) => state.values[key],
    update: async (key: string, value: unknown) => { state.writes.push({ key, value }); state.values[key] = value; },
  }),
};
export const commands = { executeCommand: async () => undefined };
export const window = {
  showQuickPick: async (items: any[], options: unknown) => {
    state.views.push({ type: 'pick', items, options });
    const value = state.answers.shift();
    return typeof value === 'string' ? items.find(item => item.label === value) : undefined;
  },
  showInputBox: async (options: any) => {
    state.views.push({ type: 'input', options });
    const value = state.answers.shift();
    if (typeof value === 'string' && options.validateInput?.(value)) throw Error('invalid-fixture-input');
    return value;
  },
  showErrorMessage: async (message: string) => { state.notices.push(message); },
  showWarningMessage: async (message: string) => { state.notices.push(message); },
  showInformationMessage: async (message: string) => { state.notices.push(message); },
};
