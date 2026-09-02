/**
 * Provider adapters. Each call returns the raw model text (expected to be a
 * JSON object) or an error message. API providers use Node 18+ global fetch;
 * account providers run the user's authenticated first-party CLI.
 */

import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import type { AIProvider } from '../config.js';
import type { JsonSchema } from './schemas.js';

export interface ProviderRequest {
  provider: AIProvider;
  apiKey: string;
  endpoint: string;       // empty → use default for openai/anthropic/gemini
  apiVersion: string;     // aoai only
  model: string;
  maxTokens: number;
  systemPrompt: string;
  userMessage: string;
  /** Repository root used as the child process cwd for local CLI providers. */
  workingDirectory?: string;
  /** Selected CLI executable or absolute path for account providers. */
  executablePath?: string;
  /** Structured final-output contract for CLI providers. */
  responseSchema?: JsonSchema;
  /** Forwarded to fetch — caller drives cancellation. */
  signal?: AbortSignal;
  /** Optional timeout (ms). Wired to AbortController if signal isn't given. */
  timeoutMs?: number;
}

export interface ProviderResponse {
  /** Raw text from the model — caller parses JSON. */
  raw: string;
  /** Set when the call failed before the model produced text. */
  error?: string;
}

export type AccountProvider = Extract<AIProvider, 'codex' | 'claudecode' | 'geminicli' | 'antigravity'>;

const DEFAULT_OPENAI = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC = 'https://api.anthropic.com/v1';
const DEFAULT_GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export async function callProvider(req: ProviderRequest): Promise<ProviderResponse> {
  switch (req.provider) {
    case 'aoai':      return callAzureOpenAI(req);
    case 'openai':    return callOpenAI(req);
    case 'anthropic': return callAnthropic(req);
    case 'gemini':    return callGemini(req);
    case 'codex':     return callCodexCli(req);
    case 'claudecode': return callClaudeCodeCli(req);
    case 'geminicli': return callGeminiCli(req);
    case 'antigravity': return callAntigravityCli(req);
    default: return { raw: '', error: `Unknown provider: ${req.provider}` };
  }
}

function ctxLine(req: ProviderRequest): string {
  const parts = [`provider=${req.provider}`];
  if (req.model)       { parts.push(`model=${req.model}`); }
  if (req.endpoint)    { parts.push(`endpoint=${req.endpoint}`); }
  if (req.apiVersion && req.provider === 'aoai') { parts.push(`api_version=${req.apiVersion}`); }
  if (req.executablePath && (req.provider === 'codex' || req.provider === 'claudecode' || req.provider === 'geminicli' || req.provider === 'antigravity')) {
    parts.push(`executable=${req.executablePath}`);
  }
  return '  Config: ' + parts.join(', ');
}

function err(req: ProviderRequest, msg: string): ProviderResponse {
  return { raw: '', error: `${msg}\n${ctxLine(req)}` };
}

async function withTimeout<T>(req: ProviderRequest, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (req.signal) { return fn(req.signal); }
  if (!req.timeoutMs) { return fn(new AbortController().signal); }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// ── Account-authenticated local CLIs ────────────────────────────────────────

const MAX_CLI_OUTPUT_BYTES = 16 * 1024 * 1024;

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

class CliProcessError extends Error {
  constructor(readonly kind: 'missing' | 'timeout' | 'output', message: string) {
    super(message);
  }
}

async function callCodexCli(req: ProviderRequest): Promise<ProviderResponse> {
  const command = req.executablePath?.trim() || 'codex';
  const args = [
    'exec',
    '--ephemeral',
    '--sandbox', 'read-only',
    '--ignore-user-config',
    '--ignore-rules',
    '--color', 'never',
  ];
  if (req.model.trim()) { args.push('--model', req.model.trim()); }

  const prompt = `${req.systemPrompt}\n\n${req.userMessage}`;
  try {
    return await withSchemaFile(req.responseSchema, async schemaFile => {
      if (schemaFile) { args.push('--output-schema', schemaFile); }
      args.push('-');
      const result = await runCli(command, args, prompt, req, process.env);
      if (result.code !== 0) {
        return err(req, cliExitMessage('Codex', result, 'Run `codex login`, then retry.'));
      }
      const raw = result.stdout.trim();
      if (!raw) {
        return err(req, `Codex CLI returned no final response.${stderrSuffix(result.stderr)}`);
      }
      return { raw };
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') { throw e; }
    return err(req, cliStartMessage('Codex', command, e, '`codex login`'));
  }
}

async function callClaudeCodeCli(req: ProviderRequest): Promise<ProviderResponse> {
  const command = req.executablePath?.trim() || 'claude';
  const schema = req.responseSchema ?? { type: 'object' };
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--tools', '',
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--no-chrome',
    '--system-prompt', req.systemPrompt,
  ];
  if (req.model.trim()) { args.push('--model', req.model.trim()); }

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = env.CLAUDE_AGENT_SDK_CLIENT_APP ?? 'commit-defender/2';

  try {
    const result = await runCli(command, args, req.userMessage, req, env);
    if (result.code !== 0) {
      return err(req, cliExitMessage('Claude Code', result, 'Run `claude auth login`, then retry.'));
    }

    let envelope: any;
    try {
      envelope = JSON.parse(result.stdout);
    } catch (e) {
      return err(req, `Claude Code returned invalid JSON: ${(e as Error).message}${stderrSuffix(result.stderr)}`);
    }
    if (envelope?.structured_output !== undefined) {
      return {
        raw: typeof envelope.structured_output === 'string'
          ? envelope.structured_output.trim()
          : JSON.stringify(envelope.structured_output),
      };
    }
    if (typeof envelope?.result === 'string' && envelope.result.trim()) {
      return { raw: envelope.result.trim() };
    }
    return err(req, `Claude Code response did not contain structured_output or result.${stderrSuffix(result.stderr)}`);
  } catch (e) {
    if ((e as Error).name === 'AbortError') { throw e; }
    return err(req, cliStartMessage('Claude Code', command, e, '`claude auth login`'));
  }
}

async function callGeminiCli(req: ProviderRequest): Promise<ProviderResponse> {
  const command = req.executablePath?.trim() || 'gemini';
  const args = [
    '--output-format', 'json',
    '--approval-mode', 'plan',
    '--skip-trust',
    '-p', req.systemPrompt,
  ];
  if (req.model.trim()) { args.unshift('--model', req.model.trim()); }

  const env = { ...process.env };
  // Force the cached Google-account login rather than an API/Vertex override.
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.GOOGLE_GENAI_USE_VERTEXAI;
  env.GOOGLE_GENAI_USE_GCA = 'true';

  try {
    const result = await runCli(command, args, req.userMessage, req, env);
    if (result.code !== 0) {
      return err(req, cliExitMessage('Gemini', result, 'Run the Commit Defender Gemini sign-in command, then retry.'));
    }
    let envelope: any;
    try {
      envelope = JSON.parse(result.stdout);
    } catch (e) {
      return err(req, `Gemini CLI returned invalid JSON: ${(e as Error).message}${stderrSuffix(result.stderr)}`);
    }
    const raw = typeof envelope?.response === 'string' ? envelope.response.trim() : '';
    if (!raw) {
      return err(req, `Gemini CLI response did not contain a response string.${stderrSuffix(result.stderr)}`);
    }
    return { raw };
  } catch (e) {
    if ((e as Error).name === 'AbortError') { throw e; }
    return err(req, cliStartMessage('Gemini', command, e, '`gemini` and select Sign in with Google'));
  }
}

async function callAntigravityCli(req: ProviderRequest): Promise<ProviderResponse> {
  const command = req.executablePath?.trim() || 'agy';
  try {
    return await withAntigravityFiles(req, async (promptFile, schemaFile, tempDir) => {
      const args = [
        '--output-format', 'json',
        '--mode', 'plan',
        '--disable-slash-commands',
        '--sandbox',
        '--add-dir', tempDir,
        '--json-schema', schemaFile,
      ];
      if (req.model.trim()) { args.push('--model', req.model.trim()); }
      args.push(
        '-p',
        `Read ${promptFile}. Treat its contents as the complete review request and return only the JSON required by the supplied schema.`,
      );

      const result = await runCli(command, args, '', req, process.env);
      if (result.code !== 0) {
        return err(req, cliExitMessage('Antigravity', result, 'Run the Commit Defender Antigravity sign-in command, then retry.'));
      }
      const raw = extractStructuredCliOutput(result.stdout);
      if (!raw) {
        return err(req, `Antigravity CLI returned no structured final response.${stderrSuffix(result.stderr)}`);
      }
      return { raw };
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') { throw e; }
    return err(req, cliStartMessage('Antigravity', command, e, '`agy` and complete sign-in'));
  }
}

async function withAntigravityFiles<T>(
  req: ProviderRequest,
  fn: (promptFile: string, schemaFile: string, tempDir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'commit-defender-agy-'));
  const promptFile = path.join(dir, 'review-request.md');
  const schemaFile = path.join(dir, 'output-schema.json');
  try {
    await Promise.all([
      writeFile(promptFile, `${req.systemPrompt}\n\n${req.userMessage}`, { encoding: 'utf8', mode: 0o600 }),
      writeFile(schemaFile, JSON.stringify(req.responseSchema ?? { type: 'object' }), { encoding: 'utf8', mode: 0o600 }),
    ]);
    return await fn(promptFile, schemaFile, dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function extractStructuredCliOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) { return ''; }
  let envelope: any;
  try { envelope = JSON.parse(trimmed); } catch { return trimmed; }
  for (const candidate of [
    envelope?.structured_output,
    envelope?.structuredOutput,
    envelope?.result,
    envelope?.response,
    envelope?.output,
  ]) {
    if (typeof candidate === 'string' && candidate.trim()) { return candidate.trim(); }
    if (candidate && typeof candidate === 'object') { return JSON.stringify(candidate); }
  }
  if (envelope && typeof envelope === 'object') { return JSON.stringify(envelope); }
  return '';
}

async function withSchemaFile<T>(schema: JsonSchema | undefined, fn: (file: string | undefined) => Promise<T>): Promise<T> {
  if (!schema) { return fn(undefined); }
  const dir = await mkdtemp(path.join(tmpdir(), 'commit-defender-'));
  const file = path.join(dir, 'output-schema.json');
  try {
    await writeFile(file, JSON.stringify(schema), { encoding: 'utf8', mode: 0o600 });
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runCli(
  command: string,
  args: string[],
  stdin: string,
  req: ProviderRequest,
  env: NodeJS.ProcessEnv,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    if (req.signal?.aborted) {
      reject(abortError());
      return;
    }

    const child = spawn(command, args, {
      cwd: req.workingDirectory || process.cwd(),
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let externallyAborted = false;
    let processError: Error | undefined;

    const finishReject = (error: Error): void => {
      if (settled) { return; }
      settled = true;
      cleanup();
      reject(error);
    };
    const terminate = (): void => {
      child.stdin.destroy();
      if (!child.killed) { child.kill('SIGTERM'); }
    };
    const onAbort = (): void => {
      externallyAborted = true;
      terminate();
    };
    const timer = req.timeoutMs && req.timeoutMs > 0
      ? setTimeout(() => {
          processError = new CliProcessError('timeout', `timed out after ${req.timeoutMs} ms`);
          terminate();
        }, req.timeoutMs)
      : undefined;
    const cleanup = (): void => {
      if (timer) { clearTimeout(timer); }
      req.signal?.removeEventListener('abort', onAbort);
    };

    req.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_CLI_OUTPUT_BYTES && !processError) {
        processError = new CliProcessError('output', 'stdout exceeded the 16 MiB safety limit');
        terminate();
      }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > MAX_CLI_OUTPUT_BYTES && !processError) {
        processError = new CliProcessError('output', 'stderr exceeded the 16 MiB safety limit');
        terminate();
      }
    });
    child.on('error', error => {
      processError = (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? new CliProcessError('missing', `executable not found: ${command}`)
        : error;
    });
    child.on('close', code => {
      if (settled) { return; }
      if (externallyAborted) {
        finishReject(abortError());
        return;
      }
      if (processError) {
        finishReject(processError);
        return;
      }
      settled = true;
      cleanup();
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE' && !processError) { processError = error; }
    });
    child.stdin.end(stdin);
  });
}

function abortError(): Error {
  const error = new Error('Cancelled');
  error.name = 'AbortError';
  return error;
}

function cliExitMessage(name: string, result: CliResult, remediation: string): string {
  const detail = tail(result.stderr || result.stdout);
  return `${name} CLI exited with code ${result.code}${detail ? `: ${detail}` : ''}\n${remediation}`;
}

function cliStartMessage(name: string, command: string, error: unknown, loginCommand: string): string {
  const e = error as Error;
  if (error instanceof CliProcessError && error.kind === 'missing') {
    return `${name} CLI executable was not found at "${command}". Install it or set the corresponding Commit Defender path setting.`;
  }
  if (error instanceof CliProcessError && error.kind === 'timeout') {
    return `${name} CLI ${error.message}.`;
  }
  return `${name} CLI failed to start: ${e.message}. Verify the executable and run ${loginCommand}.`;
}

function stderrSuffix(stderr: string): string {
  const detail = tail(stderr);
  return detail ? `\nCLI stderr: ${detail}` : '';
}

function tail(value: string, max = 2000): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(trimmed.length - max);
}

// ── Azure OpenAI ────────────────────────────────────────────────────────────

async function callAzureOpenAI(req: ProviderRequest): Promise<ProviderResponse> {
  const missing: string[] = [];
  if (!req.apiKey)   { missing.push('commitDefender.apiKey'); }
  if (!req.endpoint) { missing.push('commitDefender.endpoint'); }
  if (!req.model)    { missing.push('commitDefender.model'); }
  if (missing.length > 0) {
    return err(req, `Missing Azure OpenAI settings: ${missing.join(', ')}`);
  }

  const apiVersion = req.apiVersion || '2024-08-01-preview';
  const url = `${req.endpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(req.model)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const tryBody = (withJsonFormat: boolean): Record<string, unknown> => ({
    messages: [
      { role: 'system', content: req.systemPrompt },
      { role: 'user',   content: req.userMessage },
    ],
    max_completion_tokens: req.maxTokens,
    ...(withJsonFormat ? { response_format: { type: 'json_object' } } : {}),
  });

  return withTimeout(req, async signal => {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'api-key': req.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(tryBody(true)),
        signal,
      });
    } catch (e) {
      return err(req, `Could not reach Azure OpenAI endpoint: ${(e as Error).message}`);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      // Some deployments reject response_format — retry without it.
      if (/response_format|json_object|unsupported/i.test(body)) {
        let retry: Response;
        try {
          retry = await fetch(url, {
            method: 'POST',
            headers: { 'api-key': req.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(tryBody(false)),
            signal,
          });
        } catch (e) {
          return err(req, `Could not reach Azure OpenAI endpoint: ${(e as Error).message}`);
        }
        return parseOpenAIResp(req, retry);
      }
      return openaiHttpError(req, resp, body);
    }
    return parseOpenAIResp(req, resp);
  });
}

// ── OpenAI ──────────────────────────────────────────────────────────────────

async function callOpenAI(req: ProviderRequest): Promise<ProviderResponse> {
  if (!req.apiKey) { return err(req, 'Missing OpenAI API key. Set commitDefender.apiKey.'); }
  const base = (req.endpoint || DEFAULT_OPENAI).replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const model = req.model || 'gpt-4o';

  const tryBody = (withJsonFormat: boolean): Record<string, unknown> => ({
    model,
    messages: [
      { role: 'system', content: req.systemPrompt },
      { role: 'user',   content: req.userMessage },
    ],
    max_completion_tokens: req.maxTokens,
    ...(withJsonFormat ? { response_format: { type: 'json_object' } } : {}),
  });

  return withTimeout(req, async signal => {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${req.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(tryBody(true)),
        signal,
      });
    } catch (e) {
      return err(req, `Could not reach OpenAI API: ${(e as Error).message}`);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      if (/response_format|json_object|unsupported/i.test(body)) {
        let retry: Response;
        try {
          retry = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${req.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(tryBody(false)),
            signal,
          });
        } catch (e) {
          return err(req, `Could not reach OpenAI API: ${(e as Error).message}`);
        }
        return parseOpenAIResp(req, retry);
      }
      return openaiHttpError(req, resp, body);
    }
    return parseOpenAIResp(req, resp);
  });
}

async function parseOpenAIResp(req: ProviderRequest, resp: Response): Promise<ProviderResponse> {
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return openaiHttpError(req, resp, body);
  }
  let data: any;
  try {
    data = await resp.json();
  } catch (e) {
    return err(req, `Invalid JSON in API response: ${(e as Error).message}`);
  }
  const raw: string | undefined = data?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') {
    return err(req, `Empty or malformed response: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { raw: raw.trim() };
}

function openaiHttpError(req: ProviderRequest, resp: Response, body: string): ProviderResponse {
  const detail = body.slice(0, 600);
  if (resp.status === 401 || resp.status === 403) {
    return err(req, `Authentication failed (HTTP ${resp.status}): ${detail}`);
  }
  if (resp.status === 429) {
    return err(req, `Rate limit exceeded (HTTP 429): ${detail}`);
  }
  return err(req, `HTTP ${resp.status}: ${detail}`);
}

// ── Anthropic ───────────────────────────────────────────────────────────────

async function callAnthropic(req: ProviderRequest): Promise<ProviderResponse> {
  if (!req.apiKey) { return err(req, 'Missing Anthropic API key. Set commitDefender.apiKey.'); }
  const base = (req.endpoint || DEFAULT_ANTHROPIC).replace(/\/+$/, '');
  const url = `${base}/messages`;
  const model = req.model || 'claude-sonnet-4-6';

  const body = JSON.stringify({
    model,
    max_tokens: req.maxTokens,
    system: req.systemPrompt,
    messages: [{ role: 'user', content: req.userMessage }],
  });

  return withTimeout(req, async signal => {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': req.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body,
        signal,
      });
    } catch (e) {
      return err(req, `Could not reach Anthropic API: ${(e as Error).message}`);
    }

    if (!resp.ok) {
      const detail = (await resp.text().catch(() => '')).slice(0, 600);
      if (resp.status === 401 || resp.status === 403) {
        return err(req, `Anthropic authentication failed (HTTP ${resp.status}): ${detail}`);
      }
      if (resp.status === 429) {
        return err(req, `Anthropic rate limit exceeded (HTTP 429): ${detail}`);
      }
      return err(req, `Anthropic HTTP ${resp.status}: ${detail}`);
    }

    let data: any;
    try {
      data = await resp.json();
    } catch (e) {
      return err(req, `Invalid JSON in Anthropic response: ${(e as Error).message}`);
    }
    const block = Array.isArray(data?.content) ? data.content.find((b: any) => b?.type === 'text') : null;
    const raw: string | undefined = block?.text;
    if (typeof raw !== 'string') {
      return err(req, `Empty or malformed Anthropic response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return { raw: raw.trim() };
  });
}

// ── Google Gemini ───────────────────────────────────────────────────────────

async function callGemini(req: ProviderRequest): Promise<ProviderResponse> {
  if (!req.apiKey) { return err(req, 'Missing Gemini API key. Set commitDefender.apiKey.'); }
  const base = (req.endpoint || DEFAULT_GEMINI).replace(/\/+$/, '');
  const model = req.model || 'gemini-2.5-flash';
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: req.systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: req.userMessage }] }],
    generationConfig: {
      maxOutputTokens: req.maxTokens,
      responseMimeType: 'application/json',
    },
  });

  return withTimeout(req, async signal => {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal,
      });
    } catch (e) {
      return err(req, `Could not reach Gemini API: ${(e as Error).message}`);
    }

    if (!resp.ok) {
      const detail = (await resp.text().catch(() => '')).slice(0, 600);
      if (resp.status === 401 || resp.status === 403) {
        return err(req, `Gemini authentication failed (HTTP ${resp.status}): ${detail}`);
      }
      if (resp.status === 429) {
        return err(req, `Gemini rate limit or quota exceeded (HTTP 429): ${detail}`);
      }
      if (resp.status === 404) {
        return err(req, `Gemini model not found (HTTP 404) — check commitDefender.model: ${detail}`);
      }
      return err(req, `Gemini HTTP ${resp.status}: ${detail}`);
    }

    let data: any;
    try {
      data = await resp.json();
    } catch (e) {
      return err(req, `Invalid JSON in Gemini response: ${(e as Error).message}`);
    }
    const parts = data?.candidates?.[0]?.content?.parts;
    const raw: string | undefined = Array.isArray(parts)
      ? parts.map((p: any) => p?.text ?? '').join('')
      : undefined;
    if (typeof raw !== 'string' || !raw.trim()) {
      return err(req, `Empty or malformed Gemini response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return { raw: raw.trim() };
  });
}
