export const ui = {
  choices: [] as Array<string | number>,
  file: "",
  secret: "",
  cancelConnect: false,
  html: [] as string[],
  errors: [] as string[],
  messages: [] as string[],
  inputs: [] as Array<Record<string, unknown>>,
  reset() {
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
  async withProgress(_options: unknown, work: (progress: unknown, token: unknown) => Promise<unknown>) {
    return work(
      {},
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose() {} }),
      },
    );
  },
  createWebviewPanel() {
    return {
      webview: {
        set html(value: string) {
          ui.html.push(value);
        },
      },
      dispose() {},
    };
  },
  async showErrorMessage(message: string) {
    ui.errors.push(message);
  },
};
