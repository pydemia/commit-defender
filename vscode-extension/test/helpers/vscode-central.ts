export const ui = {
  choices: [] as Array<string | number>,
  file: "",
  secret: "",
  cancelConnect: false,
  html: [] as string[],
  errors: [] as string[],
  messages: [] as string[],
  inputs: [] as Array<Record<string, unknown>>,
  panels: [] as Array<{ disposed: boolean; dispose(): void; focus(): void }>,
  reset() {
    for (const panel of this.panels) panel.dispose();
    this.panels = [];
    this.choices = [];
    this.file = "";
    this.secret = "";
    this.cancelConnect = false;
    this.html = [];
    this.errors = [];
    this.messages = [];
    this.inputs = [];
  },
};
export const ProgressLocation = { Notification: 15 };
export const ViewColumn = { Active: -1 };
export const window = {
  async showQuickPick(items: Array<{ action?: string }>) {
    const choice = ui.choices.shift();
    return typeof choice === "number"
      ? items[choice]
      : items.find((item) => item.action === choice);
  },
  async showOpenDialog() {
    return ui.file ? [{ scheme: "file", fsPath: ui.file }] : undefined;
  },
  async showInformationMessage(
    message: string,
    options?: unknown,
    ...actions: string[]
  ) {
    ui.messages.push(message);
    return options && !ui.cancelConnect ? actions[0] : undefined;
  },
  async showInputBox(options: Record<string, unknown>) {
    ui.inputs.push(options);
    return ui.secret || undefined;
  },
  async withProgress(
    _options: unknown,
    work: (progress: unknown, token: unknown) => Promise<unknown>,
  ) {
    return work(
      {},
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose() {} }),
      },
    );
  },
  createWebviewPanel() {
    const disposals: Array<() => void> = [];
    const focus: Array<() => void> = [];
    const panel = {
      disposed: false,
      webview: {
        set html(value: string) {
          ui.html.push(value);
        },
      },
      onDidDispose(listener: () => void) {
        disposals.push(listener);
        return { dispose() {} };
      },
      onDidChangeViewState(listener: () => void) {
        focus.push(listener);
        return { dispose() {} };
      },
      focus() {
        for (const listener of focus) listener();
      },
      dispose() {
        if (!this.disposed) {
          this.disposed = true;
          for (const listener of disposals) listener();
        }
      },
    };
    ui.panels.push(panel);
    return panel;
  },
  async showErrorMessage(message: string) {
    ui.errors.push(message);
  },
};
