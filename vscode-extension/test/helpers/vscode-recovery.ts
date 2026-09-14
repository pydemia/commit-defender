export const ui = {
  choice: 0 as number | undefined,
  beforePick: () => {},
  choices: [] as any[],
  messages: [] as string[],
  errors: [] as string[],
  reset() {
    this.choice = 0;
    this.beforePick = () => {};
    this.choices = [];
    this.messages = [];
    this.errors = [];
  },
};
export const ProgressLocation = { Notification: 15 };
export const window = {
  async showQuickPick(items: any[]) {
    ui.choices = items;
    ui.beforePick();
    return ui.choice === undefined ? undefined : items[ui.choice];
  },
  async showInformationMessage(message: string) {
    ui.messages.push(message);
  },
  async showErrorMessage(message: string) {
    ui.errors.push(message);
  },
  async withProgress(_options: unknown, work: () => Promise<unknown>) {
    return work();
  },
};
