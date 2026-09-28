export const values = {
  global: {} as Record<string, unknown>,
  repository: {} as Record<string, unknown>,
  reads: [] as string[],
  scope: undefined as unknown,
};
export const Uri = { file: (fsPath: string) => ({ fsPath }) };
export const workspace = {
  isTrusted: true,
  getConfiguration: (_section?: string, scope?: unknown) => {
    values.scope = scope;
    return {
      inspect: (name: string) => {
        values.reads.push(name);
        return {
          globalValue: values.global[name],
          workspaceValue: values.repository[name],
        };
      },
      get: (name: string) => {
        values.reads.push(name);
        return values.repository[name] ?? values.global[name];
      },
    };
  },
};
export const extensions = { getExtension: () => undefined };
