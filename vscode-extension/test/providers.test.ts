import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callProvider, type ProviderRequest } from '../src/ai/providers.js';
import { REVIEW_OUTPUT_SCHEMA } from '../src/ai/schemas.js';

const REVIEW = {
  summary: 'Looks good.',
  blocking: false,
  grade: 'proficient',
  file_comments: [],
};

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    provider: 'codex',
    apiKey: '',
    endpoint: '',
    apiVersion: '',
    model: '',
    maxTokens: 4096,
    systemPrompt: 'SYSTEM_MARKER',
    userMessage: 'USER_MARKER',
    workingDirectory: process.cwd(),
    responseSchema: REVIEW_OUTPUT_SCHEMA,
    ...overrides,
  };
}

async function fakeCli(): Promise<{ dir: string; executable: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'commit-defender-test-'));
  const executable = path.join(dir, 'fake-ai-cli');
  await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  if (input.includes('SLOW')) return setTimeout(() => process.stdout.write('{}'), 1000);
  if (args[0] === 'exec') {
    const schemaIndex = args.indexOf('--output-schema');
    if (schemaIndex < 0 || !fs.existsSync(args[schemaIndex + 1])) process.exit(21);
    const schema = JSON.parse(fs.readFileSync(args[schemaIndex + 1], 'utf8'));
    if (!schema.required.includes('file_comments')) process.exit(22);
    if (!args.includes('--ephemeral') || !args.includes('read-only')) process.exit(23);
    if (!input.includes('SYSTEM_MARKER') || !input.includes('USER_MARKER')) process.exit(24);
    process.stdout.write(JSON.stringify(${JSON.stringify(REVIEW)}));
    return;
  }
  if (args[0] === '-p') {
    const toolsIndex = args.indexOf('--tools');
    if (toolsIndex < 0 || args[toolsIndex + 1] !== '') process.exit(31);
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) process.exit(32);
    if (!input.includes('USER_MARKER')) process.exit(33);
    process.stdout.write(JSON.stringify({ structured_output: ${JSON.stringify(REVIEW)} }));
    return;
  }
  if (args.includes('--mode') && args.includes('plan')) {
    if (!args.includes('--disable-slash-commands') || !args.includes('--sandbox')) process.exit(51);
    const schemaIndex = args.indexOf('--json-schema');
    if (schemaIndex < 0 || !fs.existsSync(args[schemaIndex + 1])) process.exit(52);
    const schema = JSON.parse(fs.readFileSync(args[schemaIndex + 1], 'utf8'));
    if (!schema.required.includes('file_comments')) process.exit(53);
    const addDirIndex = args.indexOf('--add-dir');
    const promptFile = addDirIndex < 0 ? '' : require('node:path').join(args[addDirIndex + 1], 'review-request.md');
    if (!promptFile || !fs.existsSync(promptFile)) process.exit(54);
    const prompt = fs.readFileSync(promptFile, 'utf8');
    if (!prompt.includes('SYSTEM_MARKER') || !prompt.includes('USER_MARKER')) process.exit(55);
    const printIndex = args.indexOf('-p');
    if (printIndex < 0 || !args[printIndex + 1].includes('review-request.md')) process.exit(56);
    process.stdout.write(JSON.stringify({ structured_output: ${JSON.stringify(REVIEW)} }));
    return;
  }
  if (args.includes('--output-format')) {
    const formatIndex = args.indexOf('--output-format');
    if (args[formatIndex + 1] !== 'json' || !args.includes('--approval-mode') || !args.includes('plan')) process.exit(41);
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_USE_VERTEXAI || process.env.GOOGLE_GENAI_USE_GCA !== 'true') process.exit(42);
    if (!input.includes('USER_MARKER')) process.exit(43);
    process.stdout.write(JSON.stringify({ response: JSON.stringify(${JSON.stringify(REVIEW)}) }));
    return;
  }
  process.exit(40);
});
`);
  await chmod(executable, 0o755);
  return { dir, executable };
}

test('Codex provider uses read-only exec and normalizes structured output', async () => {
  const fake = await fakeCli();
  try {
    const response = await callProvider(request({ executablePath: fake.executable }));
    assert.equal(response.error, undefined);
    assert.deepEqual(JSON.parse(response.raw), REVIEW);
  } finally {
    await rm(fake.dir, { recursive: true, force: true });
  }
});

test('Claude Code provider disables tools, sanitizes API-key auth, and unwraps structured output', async () => {
  const fake = await fakeCli();
  const oldKey = process.env.ANTHROPIC_API_KEY;
  const oldToken = process.env.ANTHROPIC_AUTH_TOKEN;
  process.env.ANTHROPIC_API_KEY = 'must-not-leak';
  process.env.ANTHROPIC_AUTH_TOKEN = 'must-not-leak';
  try {
    const response = await callProvider(request({
      provider: 'claudecode',
      executablePath: fake.executable,
    }));
    assert.equal(response.error, undefined);
    assert.deepEqual(JSON.parse(response.raw), REVIEW);
  } finally {
    if (oldKey === undefined) { delete process.env.ANTHROPIC_API_KEY; } else { process.env.ANTHROPIC_API_KEY = oldKey; }
    if (oldToken === undefined) { delete process.env.ANTHROPIC_AUTH_TOKEN; } else { process.env.ANTHROPIC_AUTH_TOKEN = oldToken; }
    await rm(fake.dir, { recursive: true, force: true });
  }
});

test('CLI provider reports a missing executable without throwing', async () => {
  const response = await callProvider(request({ executablePath: '/definitely/missing/commit-defender-codex' }));
  assert.match(response.error ?? '', /executable was not found/i);
});

test('CLI provider enforces its standalone timeout', async () => {
  const fake = await fakeCli();
  try {
    const response = await callProvider(request({
      executablePath: fake.executable,
      userMessage: 'SLOW',
      timeoutMs: 25,
    }));
    assert.match(response.error ?? '', /timed out/i);
  } finally {
    await rm(fake.dir, { recursive: true, force: true });
  }
});

test('CLI provider propagates cancellation as AbortError', async () => {
  const fake = await fakeCli();
  const controller = new AbortController();
  try {
    const pending = callProvider(request({
      executablePath: fake.executable,
      userMessage: 'SLOW',
      signal: controller.signal,
    }));
    setTimeout(() => controller.abort(), 25);
    await assert.rejects(pending, error => (error as Error).name === 'AbortError');
  } finally {
    await rm(fake.dir, { recursive: true, force: true });
  }
});

test('Gemini CLI provider uses cached Google auth and unwraps JSON output', async () => {
  const fake = await fakeCli();
  const oldGemini = process.env.GEMINI_API_KEY;
  const oldGoogle = process.env.GOOGLE_API_KEY;
  const oldVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI;
  process.env.GEMINI_API_KEY = 'must-not-leak';
  process.env.GOOGLE_API_KEY = 'must-not-leak';
  process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
  try {
    const response = await callProvider(request({ provider: 'geminicli', executablePath: fake.executable }));
    assert.equal(response.error, undefined);
    assert.deepEqual(JSON.parse(response.raw), REVIEW);
  } finally {
    if (oldGemini === undefined) { delete process.env.GEMINI_API_KEY; } else { process.env.GEMINI_API_KEY = oldGemini; }
    if (oldGoogle === undefined) { delete process.env.GOOGLE_API_KEY; } else { process.env.GOOGLE_API_KEY = oldGoogle; }
    if (oldVertex === undefined) { delete process.env.GOOGLE_GENAI_USE_VERTEXAI; } else { process.env.GOOGLE_GENAI_USE_VERTEXAI = oldVertex; }
    await rm(fake.dir, { recursive: true, force: true });
  }
});

test('Antigravity provider uses agy plan/sandbox mode and temp-file prompt', async () => {
  const fake = await fakeCli();
  try {
    const response = await callProvider(request({
      provider: 'antigravity',
      executablePath: fake.executable,
    }));
    assert.equal(response.error, undefined);
    assert.deepEqual(JSON.parse(response.raw), REVIEW);
  } finally {
    await rm(fake.dir, { recursive: true, force: true });
  }
});
