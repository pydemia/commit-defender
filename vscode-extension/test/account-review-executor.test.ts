import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareAccountReviewExecutor } from '../src/accountReviewExecutor.js';
import type { StandaloneReviewSettings } from '../src/standaloneReviewProtocol.js';

const source = {
  async execute(tool: string) {
    return JSON.stringify(tool === 'list_files'
      ? { files: [{ path: 'sum.ts', side: 'source', lineCount: 1 }], nextOffset: null }
      : { status: 'available', path: 'sum.ts', side: 'source', startLine: 1, endLine: 1,
        readId: 'fixed-read-witness', content: 'return left + right;', truncated: false });
  },
};
const response = { summary: 'Read supplied source', files: [], findings: [], questions: [] };
for (const provider of ['claudecode', 'antigravity'] as const) {
  for (const scenario of ['complete', 'failed', 'partial', 'unsafe-tools', 'cancelled', 'timeout']) {
    test(`${provider} captured text review: ${scenario}`, { skip: process.platform === 'win32' }, async t => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'cd-account-test-'));
      t.after(() => rm(dir, { recursive: true, force: true }));
      const executable = path.join(dir, 'cli');
      const record = path.join(dir, 'call.json');
      await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('--safe-mode --tools --strict-mcp-config --system-prompt-file --effort --agent --input-format --output-format --json-schema --disable-slash-commands'); process.exit(); }
if (args.includes('--version')) { console.log('fixture-1'); process.exit(); }
let input = '';
process.stdin.on('data', bytes => input += bytes);
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, input, cwd: process.cwd(),
    apiKeysAbsent: !process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY, files: fs.readdirSync('.') }));
  if (${JSON.stringify(scenario)} === 'cancelled' || ${JSON.stringify(scenario)} === 'timeout') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); return; }
  const output = ${JSON.stringify(response)};
  if (${JSON.stringify(provider)} === 'claudecode') console.log(JSON.stringify({ type: 'result', is_error: ${scenario === 'failed'}, subtype: ${JSON.stringify(scenario === 'partial' ? 'error_max_turns' : 'success')}, structured_output: output }));
  else {
    console.log(JSON.stringify({ event: 'init', init: { model: 'explicit-model', tools: ['finish', 'view_file'], agent: args[args.indexOf('--agent')+1] } }));
    if (${JSON.stringify(scenario)} === 'unsafe-tools') console.log(JSON.stringify({event:'step_update',step_update:{step_type:'view_file'}}));
    console.log(JSON.stringify({ event: 'result', result: { status: ${JSON.stringify(scenario === 'failed' ? 'ERROR' : scenario === 'partial' ? 'WAITING' : 'SUCCESS')}, response: JSON.stringify(output) } }));
  }
});
`, { mode: 0o700 });
      await chmod(executable, 0o700);
      const settings: StandaloneReviewSettings = { mode: 'standalone', profileId: 'test', provider,
        model: 'explicit-model', reasoningEffort: 'high', executablePath: executable, workspaceTrusted: true,
        durationMs: 5000, excludePatterns: [] };
      const executor = await prepareAccountReviewExecutor(settings);
      assert.equal(executor.descriptor.model, 'explicit-model');
      const abort = new AbortController();
      const timer = scenario === 'cancelled' ? setTimeout(() => abort.abort(), 1000) : undefined;
      try {
        const run = executor.review({ prompt: 'Review the supplied source', source, signal: abort.signal,
          timeoutMs: scenario === 'timeout' ? 1000 : 5000, responseSchema: { type: 'object' } });
        if (scenario === 'complete' || (provider === 'claudecode' && scenario === 'unsafe-tools'))
          assert.deepEqual(JSON.parse((await run).raw), response);
        else await assert.rejects(run, (error: any) => scenario === 'cancelled' ? error.name === 'AbortError'
          : error.code === (scenario === 'timeout' ? 'timeout' : scenario === 'unsafe-tools' ? 'executor-unavailable' : 'model-failed'));
      } finally { if (timer) clearTimeout(timer); }
      const call = JSON.parse(await readFile(record, 'utf8'));
      assert(call.input.includes('fixed-read-witness'));
      assert(call.apiKeysAbsent);
      assert.notEqual(call.cwd, process.cwd());
      assert.equal(call.args[call.args.indexOf('--model') + 1], 'explicit-model');
      assert.equal(call.args[call.args.indexOf('--effort') + 1], 'high');
      if (provider === 'claudecode') {
        assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
        assert(call.args.includes('--safe-mode')); assert(call.args.includes('--no-session-persistence'));
      } else assert(call.args.includes('--agent'));
      await assert.rejects(access(call.cwd));
    });
  }
}
