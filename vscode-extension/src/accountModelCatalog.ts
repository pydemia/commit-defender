import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runManagedProcess, type ManagedProcessInput } from './ai/managedProcess.js';

export type SetupAccountProvider = 'codex' | 'claudecode' | 'antigravity';
export interface AccountModel {
  id: string;
  label: string;
  description: string;
  efforts: string[];
  defaultEffort: string;
  /** AGY exposes effort variants as separate model IDs. */
  variants?: Record<string, string>;
}
export class AccountCatalogError extends Error {
  constructor(readonly code: 'cli-unavailable' | 'auth-unavailable' | 'connection-failed' | 'invalid-catalog' | 'catalog-unavailable') {
    super(code);
  }
}
export function accountEnvironment(provider: SetupAccountProvider): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DISABLE_AUTOUPDATER: '1', AGY_CLI_DISABLE_AUTO_UPDATE: 'true' };
  for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
    'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GEMINI_BASE_URL']) delete env[name];
  if (provider === 'codex') env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}
const text = (value: unknown, maximum = 512): string =>
  typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value) ? value : '';
const supported = (items: unknown, allowed: readonly string[]) => Array.isArray(items)
  ? [...new Set(items.filter((value): value is string => typeof value === 'string' && allowed.includes(value)))] : [];

export function parseCodexModels(raw: unknown): AccountModel[] {
  if (!Array.isArray(raw)) throw new AccountCatalogError('invalid-catalog');
  return raw.filter(m => m && !m.hidden).map(m => {
    const id = text(m.model, 128);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new AccountCatalogError('invalid-catalog');
    // The existing fixed-source executor does not enable max/ultra delegation.
    const efforts = supported(m.supportedReasoningEfforts?.map((e: any) => e.reasoningEffort),
      ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
    return { id, label: text(m.displayName) || id, description: text(m.description), efforts,
      defaultEffort: efforts.includes(m.defaultReasoningEffort) ? m.defaultReasoningEffort : efforts[0] ?? '' };
  }).filter(m => m.efforts.length > 0);
}
export function parseClaudeModels(raw: unknown): AccountModel[] {
  if (!Array.isArray(raw)) throw new AccountCatalogError('invalid-catalog');
  return raw.map(m => {
    const id = text(m?.value);
    if (!id) throw new AccountCatalogError('invalid-catalog');
    const efforts = m.supportsEffort === true
      ? supported(m.supportedEffortLevels, ['low', 'medium', 'high', 'xhigh', 'max']) : [];
    return { id, label: text(m.displayName) || id, description: text(m.description), efforts, defaultEffort: '' };
  });
}
export function parseAntigravityModels(raw: string): AccountModel[] {
  const models = new Map<string, AccountModel>();
  for (const line of raw.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const match = /^([a-zA-Z0-9][a-zA-Z0-9._-]{0,127})\t([^\t]+)$/.exec(line);
    if (!match) continue;
    const [, id, label] = match;
    const variant = /^(.*)-(low|medium|high|max)$/.exec(id);
    // Never invent a sibling model/effort. Each variant must be returned by the CLI.
    const group = variant ? variant[1] : id;
    const entry = models.get(group) ?? { id, label: variant ? label.replace(/ \((Low|Medium|High|Max)\)$/, '') : label,
      description: 'Available to the signed-in Antigravity account', efforts: [], defaultEffort: '', variants: {} };
    if (variant) { entry.efforts.push(variant[2]); entry.variants![variant[2]] = id; entry.defaultEffort ||= variant[2]; }
    models.set(group, entry);
  }
  return [...models.values()];
}

export async function loadAccountModels(provider: SetupAccountProvider, executablePath: string,
  options: { signal?: AbortSignal; workerPath: string; run?: typeof runManagedProcess }): Promise<AccountModel[]> {
  if (!path.isAbsolute(executablePath)) throw new AccountCatalogError('cli-unavailable');
  let command: string;
  try { command = await realpath(executablePath); } catch { throw new AccountCatalogError('cli-unavailable'); }
  if (process.platform === 'win32' && !command.toLowerCase().endsWith('.exe')) throw new AccountCatalogError('cli-unavailable');
  const env = accountEnvironment(provider);
  const run = options.run ?? runManagedProcess;
  const invoke = (args: string[], stdin = '', override?: string) => run({ command: override ?? command, args,
    cwd: os.tmpdir(), env, stdin, timeoutMs: 30_000, outputBytes: 2_097_152, signal: options.signal } satisfies ManagedProcessInput);
  let models: AccountModel[];
  if (provider === 'codex') {
    const version = await invoke(['--version']);
    // Match the frozen executor artifact's supported executable versions.
    if (!['codex-cli 0.153.4', 'codex-cli 0.154.0'].includes(version.stdout.trim()))
      throw new AccountCatalogError('cli-unavailable');
    const result = await invoke([options.workerPath, command], '', process.execPath);
    if (result.code !== 0) throw new AccountCatalogError('catalog-unavailable');
    let value: any;
    try { value = JSON.parse(result.stdout); } catch { throw new AccountCatalogError('invalid-catalog'); }
    if (value.error) throw new AccountCatalogError(['auth-unavailable', 'connection-failed', 'cli-unavailable'].includes(value.error) ? value.error : 'catalog-unavailable');
    models = parseCodexModels(value.models);
    const bundled = await invoke(['debug', 'models', '--bundled']);
    let local: any;
    try { local = JSON.parse(bundled.stdout); } catch { throw new AccountCatalogError('invalid-catalog'); }
    const available = Array.isArray(local) ? local : local.models;
    if (bundled.code !== 0 || !Array.isArray(available)) throw new AccountCatalogError('invalid-catalog');
    models = models.map(model => {
      const descriptor = available.find((entry: any) => entry.slug === model.id);
      const efforts = model.efforts.filter(e => descriptor?.supported_reasoning_levels?.some((v: any) => v.effort === e));
      return { ...model, efforts, defaultEffort: efforts.includes(model.defaultEffort) ? model.defaultEffort : efforts[0] ?? '' };
    }).filter(model => model.efforts.length > 0);
  } else if (provider === 'claudecode') {
    const auth = await invoke(['auth', 'status', '--json']);
    let status: any;
    try { status = JSON.parse(auth.stdout); } catch { throw new AccountCatalogError('auth-unavailable'); }
    if (auth.code !== 0 || status.loggedIn !== true || status.authMethod !== 'claude.ai') throw new AccountCatalogError('auth-unavailable');
    const input = [{ type: 'control_request', request_id: 'cd-models', request: { subtype: 'initialize' } },
      { type: 'control_request', request_id: 'cd-connection', request: { subtype: 'get_usage' } }].map(v => JSON.stringify(v)).join('\n') + '\n';
    const result = await invoke(['--safe-mode', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--verbose', '--tools', '', '--no-session-persistence', '--disable-slash-commands', '--no-chrome',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], input);
    if (result.code !== 0) throw new AccountCatalogError('connection-failed');
    let responses: any[];
    try { responses = result.stdout.trim().split('\n').map(line => JSON.parse(line)).filter(v => v.type === 'control_response').map(v => v.response); }
    catch { throw new AccountCatalogError('invalid-catalog'); }
    const catalog = responses.find(v => v.request_id === 'cd-models');
    const connection = responses.find(v => v.request_id === 'cd-connection');
    if (catalog?.subtype !== 'success' || connection?.subtype !== 'success'
      || connection.response?.rate_limits_available !== true) throw new AccountCatalogError('connection-failed');
    models = parseClaudeModels(catalog.response.models);
  } else {
    const result = await invoke(['models']);
    if (result.code !== 0) throw new AccountCatalogError('connection-failed');
    models = parseAntigravityModels(result.stdout);
  }
  if (!models.length || models.length > 500) throw new AccountCatalogError('catalog-unavailable');
  if (new Set(models.map(m => m.id)).size !== models.length) throw new AccountCatalogError('invalid-catalog');
  return models;
}
