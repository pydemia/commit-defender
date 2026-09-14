export const ui = {
  choices: [] as number[],
  panels: [] as Array<{
    html: string;
    send(value: unknown): void;
    dispose(): void;
    disposed: boolean;
  }>,
  messages: [] as string[],
  reset() {
    this.choices = [];
    this.panels = [];
    this.messages = [];
  },
};
export const ViewColumn = { Active: -1 };
export class CancellationTokenSource {
  token = { isCancellationRequested: false };
  cancel() {
    this.token.isCancellationRequested = true;
  }
  dispose() {}
}
export const window = {
  async showQuickPick<T>(
    items: T[],
    _options?: unknown,
    token?: { isCancellationRequested: boolean },
  ) {
    return token?.isCancellationRequested
      ? undefined
      : items[ui.choices.shift() ?? -1];
  },
  async showWarningMessage(
    _message: string,
    _options: unknown,
    action: string,
  ) {
    return action;
  },
  async showInformationMessage(message: string) {
    ui.messages.push(message);
  },
  createWebviewPanel() {
    let receive: ((value: unknown) => void) | undefined,
      close: (() => void) | undefined;
    const panel = {
      html: "",
      disposed: false,
      send(value: unknown) {
        receive?.(value);
      },
      dispose() {
        if (panel.disposed) return;
        panel.disposed = true;
        close?.();
      },
    };
    ui.panels.push(panel);
    return {
      dispose: () => panel.dispose(),
      onDidDispose(callback: () => void) {
        close = callback;
        return {
          dispose() {
            close = undefined;
          },
        };
      },
      webview: {
        set html(value: string) {
          panel.html = value;
        },
        onDidReceiveMessage(callback: (value: unknown) => void) {
          receive = callback;
          return {
            dispose() {
              receive = undefined;
            },
          };
        },
      },
    };
  },
};
