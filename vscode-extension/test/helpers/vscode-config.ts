export const values = {
  global: {} as Record<string, unknown>,
  repository: {} as Record<string, unknown>,
  reads: [] as string[],
};
export const workspace = {
  isTrusted: true,
  getConfiguration: () => ({
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
  }),
};
export const extensions = { getExtension: () => undefined };
