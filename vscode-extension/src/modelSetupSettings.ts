import { canonicalJson } from '@gcr/client-core';

export interface ModelSettingsPort {
  read(key: string): unknown;
  write(key: string, value: unknown): Promise<void>;
}
export const modelSetupKeys = ['localProfile', 'aiProvider', 'model', 'endpoint', 'apiVersion',
  'reviewReasoningEffort', 'modelCredentialRef', 'codexPath', 'claudeCodePath', 'antigravityPath'] as const;
const same = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b);
export function captureModelSettings(port: ModelSettingsPort): Record<string, unknown> {
  return Object.fromEntries(modelSetupKeys.map(key => [key, port.read(key)]));
}
export function modelSettingsUnchanged(port: ModelSettingsPort, snapshot: Record<string, unknown>): boolean {
  return modelSetupKeys.every(key => same(port.read(key), snapshot[key]));
}
/** Called after every input and validation completes. Provider is committed last.
 * Roll back only our writes; a concurrent user change must never be overwritten. */
export async function commitModelSettings(port: ModelSettingsPort, snapshot: Record<string, unknown>,
  values: Record<string, unknown>): Promise<void> {
  const expected = { ...snapshot };
  const written: string[] = [];
  try {
    if (!modelSettingsUnchanged(port, expected)) throw Error('configuration-changed');
    const entries = Object.entries(values).sort(([a], [b]) => a === 'aiProvider' ? 1 : b === 'aiProvider' ? -1 : 0);
    for (const [key, value] of entries) {
      if (!modelSettingsUnchanged(port, expected)) throw Error('configuration-changed');
      await port.write(key, value); written.push(key); expected[key] = value;
      if (!modelSettingsUnchanged(port, expected)) throw Error('configuration-changed');
    }
  } catch (error) {
    for (const key of written.reverse()) {
      if (same(port.read(key), expected[key])) await port.write(key, snapshot[key]);
    }
    throw error;
  }
}
