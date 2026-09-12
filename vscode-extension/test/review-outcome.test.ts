import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { callProvider, type ProviderRequest } from '../src/ai/providers.js';
import { Reviewer } from '../src/ai/reviewer.js';
import { parseReviewJson } from '../src/ai/json.js';
import { normalizeReport } from '../src/commentFormatter.js';
import { resolveExitCode } from '../src/exitResolver.js';
import {
  OUTCOME_META,
  reviewCoverage,
  reviewStatus,
} from '../src/reviewOutcome.js';
import type {
  AnalysisReport,
  FileComment,
  ReviewResult,
} from '../src/types.js';
import { fixture } from './helpers/review-fixture.js';

const comment: FileComment = {
  file: 'first.ts',
  line: 1,
  category: 'correctness',
  priority: 'P3',
  comment: 'Caller loses a required value.',
};
const clean = {
  summary: 'Reviewed selected source.',
  blocking: false,
  grade: 'proficient',
  file_comments: [],
};
const defect = { ...clean, file_comments: [comment] };
type Reply = { raw?: string; fail?: boolean; wait?: boolean };
function setup(
  replies: Reply[],
  files = ['first.ts', 'second.ts', 'third.ts'],
) {
  const f = fixture();
  for (const file of files) f.write(file, 'export const value = 1;\n');
  fs.writeFileSync(
    f.executable,
    `#!/usr/bin/env node
const fs = require('node:fs'); const replies = ${JSON.stringify(replies)};
let text = ''; process.stdin.on('data', chunk => text += chunk);
process.stdin.on('end', () => {
  const capture = ${JSON.stringify(f.capture)};
  const count = fs.existsSync(capture) ? fs.readFileSync(capture, 'utf8').trim().split('\\n').length : 0;
  fs.appendFileSync(capture, JSON.stringify(text) + '\\n');
  const reply = replies[Math.min(count, replies.length - 1)];
  if (reply.wait) return setTimeout(() => process.stdout.write('{}'), 10000);
  if (reply.fail) { process.stderr.write('SYNTHETIC_PROVIDER_FAILURE'); process.exit(3); }
  process.stdout.write(reply.raw);
});
`,
  );
  const calls = () =>
    fs.existsSync(f.capture)
      ? fs.readFileSync(f.capture, 'utf8').trim().split('\n').length
      : 0;
  return { ...f, calls };
}
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error('fixture did not reach expected request');
    await delay(10);
  }
}
function report(review: Partial<ReviewResult> = {}): AnalysisReport {
  return {
    schema_version: 1,
    staged_files: ['first.ts'],
    duration_ms: 1,
    exit_code: 0,
    lint_findings: [],
    review: { ...clean, grade: 'proficient', is_error: false, ...review },
  };
}
function apiRequest(
  provider: ProviderRequest['provider'],
  overrides: Partial<ProviderRequest> = {},
): ProviderRequest {
  return {
    provider,
    apiKey: 'SYNTHETIC_TEST_KEY',
    endpoint: 'http://127.0.0.1:1',
    apiVersion: 'fixture',
    model: 'fixture',
    maxTokens: 200,
    systemPrompt: 'fixture',
    userMessage: 'fixture',
    ...overrides,
  };
}

test('all provider failures remain failed with no fabricated P3 finding or successful grade', async () => {
  const f = setup([{ fail: true }]);
  try {
    const { report: result } = await new Reviewer(f.cfg).reviewFilesSeparately(
      f.repo,
      ['first.ts', 'second.ts'],
    );
    assert.equal(result.review.status, 'failed');
    assert(result.review.is_error);
    assert.equal(result.review.grade, '');
    assert.deepEqual(normalizeReport(result), []);
    assert.deepEqual(
      result.review.per_file_summaries?.map((entry) => entry.status),
      ['failed', 'failed'],
    );
    assert(
      result.review.per_file_summaries?.every(
        (entry) => entry.priority === undefined,
      ),
    );
    assert.equal(resolveExitCode(result), 0);
    assert.equal(resolveExitCode(result, 'advisory'), 0);
    assert.equal(
      reviewCoverage(result),
      '0/2 selected file(s) completed; 2 failed',
    );
  } finally {
    f.cleanup();
  }
});

test('partial failure preserves actual P3 findings and keeps advisory separate from legacy hook enforcement', async () => {
  const f = setup([{ raw: JSON.stringify(defect) }, { fail: true }]);
  try {
    const { report: result } = await new Reviewer(f.cfg).reviewFilesSeparately(
      f.repo,
      ['first.ts', 'second.ts'],
    );
    assert.equal(result.review.status, 'partial');
    assert(!result.review.is_error);
    assert.deepEqual(result.review.file_comments, [comment]);
    assert.equal(result.review.grade, '');
    assert.deepEqual(
      result.review.per_file_summaries?.map((entry) => entry.status),
      ['completed', 'failed'],
    );
    assert.equal(result.exit_code, 1);
    assert.equal(resolveExitCode(result, 'advisory'), 0);
    assert.equal(
      reviewCoverage(result),
      '1/2 selected file(s) completed; 1 failed',
    );
  } finally {
    f.cleanup();
  }
});

test('completed clean review does not manufacture findings from its summary', async () => {
  const f = setup([
    {
      raw: JSON.stringify({
        ...clean,
        summary: 'The code handles the AI review unavailable message.',
      }),
    },
  ]);
  try {
    const { report: result } = await new Reviewer(f.cfg).reviewFilesSeparately(
      f.repo,
      ['first.ts', 'second.ts'],
    );
    assert.equal(reviewStatus(result.review), 'completed');
    assert.deepEqual(normalizeReport(result), []);
    assert.equal(result.exit_code, 0);
    assert.equal(reviewCoverage(result), '2/2 selected file(s) completed');
    assert.equal(OUTCOME_META[reviewStatus(result.review)].label, 'Completed');
  } finally {
    f.cleanup();
  }
});

test('cancellation before execution calls no provider and remains cancelled rather than pass', async () => {
  const f = setup([{ raw: JSON.stringify(clean) }]);
  const controller = new AbortController();
  controller.abort('user');
  try {
    for (const result of [
      await new Reviewer(f.cfg).reviewFilesSeparately(
        f.repo,
        ['first.ts'],
        controller.signal,
      ),
      await new Reviewer(f.cfg).reviewDiff(
        f.repo,
        ['first.ts'],
        controller.signal,
      ),
    ]) {
      assert.equal(result.report.review.status, 'cancelled');
      assert(result.cancelled);
      assert(!result.timedOut);
      assert.deepEqual(normalizeReport(result.report), []);
    }
    assert.equal(f.calls(), 0);
  } finally {
    f.cleanup();
  }
});

for (const reason of ['user', 'timeout']) {
  test(`${reason} during the second file preserves the first finding and records unperformed work`, async () => {
    const f = setup([{ raw: JSON.stringify(defect) }, { wait: true }]);
    const controller = new AbortController();
    try {
      const pending = new Reviewer(f.cfg).reviewFilesSeparately(
        f.repo,
        ['first.ts', 'second.ts', 'third.ts'],
        controller.signal,
      );
      await waitFor(() => f.calls() === 2);
      controller.abort(reason);
      const result = await pending;
      assert.equal(
        result.report.review.status,
        reason === 'user' ? 'cancelled' : 'partial',
      );
      assert.equal(result.cancelled, reason === 'user');
      assert.equal(result.timedOut, reason === 'timeout');
      assert.deepEqual(result.report.review.file_comments, [comment]);
      assert.deepEqual(
        result.report.review.per_file_summaries?.map((entry) => entry.status),
        ['completed', reason === 'user' ? 'cancelled' : 'failed', 'not-run'],
      );
      assert.equal(resolveExitCode(result.report), reason === 'user' ? 0 : 1);
      assert.equal(resolveExitCode(result.report, 'advisory'), 0);
      assert.equal(f.calls(), 2);
    } finally {
      controller.abort();
      f.cleanup();
    }
  });
}

test('timeout before any completed file is failed and never cancellation or a grade', async () => {
  const f = setup([{ wait: true }]);
  const controller = new AbortController();
  try {
    const pending = new Reviewer(f.cfg).reviewFilesSeparately(
      f.repo,
      ['first.ts', 'second.ts'],
      controller.signal,
    );
    await waitFor(() => f.calls() === 1);
    controller.abort('timeout');
    const result = await pending;
    assert.equal(result.report.review.status, 'failed');
    assert(result.report.review.is_error);
    assert(result.timedOut);
    assert(!result.cancelled);
    assert.equal(result.report.review.grade, '');
    assert.deepEqual(
      result.report.review.per_file_summaries?.map((entry) => entry.status),
      ['failed', 'not-run'],
    );
  } finally {
    controller.abort();
    f.cleanup();
  }
});

test('source truncation marks otherwise valid file and staged reviews partial', async () => {
  const f = setup([{ raw: JSON.stringify(clean) }], ['first.ts']);
  try {
    f.write('first.ts', 'export const data = "' + 'x'.repeat(81000) + '";\n');
    f.git('add', 'first.ts');
    for (const result of [
      await new Reviewer(f.cfg).reviewFilesSeparately(f.repo, ['first.ts']),
      await new Reviewer(f.cfg).reviewDiff(f.repo, ['first.ts']),
    ]) {
      assert.equal(result.report.review.status, 'partial');
      assert(
        result.report.review.incomplete_reasons?.includes('source-truncated'),
      );
      assert(!result.report.review.is_error);
      assert.equal(result.report.review.grade, '');
    }
  } finally {
    f.cleanup();
  }
});

test('repaired model JSON is partial, while complete but unusable JSON is an error', async () => {
  const f = setup([
    { raw: JSON.stringify(defect).slice(0, -1) },
    { raw: '{}' },
  ]);
  try {
    const result = await new Reviewer(f.cfg).reviewFilesSeparately(f.repo, [
      'first.ts',
      'second.ts',
    ]);
    assert.equal(result.report.review.status, 'partial');
    assert.deepEqual(
      result.report.review.per_file_summaries?.map((entry) => entry.status),
      ['partial', 'failed'],
    );
    assert.deepEqual(result.report.review.file_comments, [comment]);
    assert(
      result.report.review.incomplete_reasons?.includes('response-truncated'),
    );
    assert(parseReviewJson('{"summary":"braces }').truncated);
    assert.throws(() =>
      parseReviewJson('{"summary":"x","blocking":"false","file_comments":[]}'),
    );
  } finally {
    f.cleanup();
  }
});

for (const provider of ['openai', 'aoai', 'anthropic', 'gemini'] as const) {
  test(`${provider} does not swallow cancellation during HTTP response body parsing`, async (context) => {
    const controller = new AbortController();
    let parsing = false;
    context.mock.method(
      globalThis,
      'fetch',
      async (_input: unknown, init: RequestInit) =>
        ({
          ok: true,
          json: () =>
            new Promise((_resolve, reject) => {
              parsing = true;
              init.signal?.addEventListener(
                'abort',
                () => reject(new Error('synthetic body cancellation')),
                { once: true },
              );
            }),
        }) as Response,
    );
    try {
      const pending = callProvider(
        apiRequest(provider, { signal: controller.signal }),
      );
      await waitFor(() => parsing);
      controller.abort('user');
      await assert.rejects(
        pending,
        (error) => (error as Error).name === 'AbortError',
      );
    } finally {
      context.mock.restoreAll();
    }
  });
}

test('HTTP request timeout still applies when an external cancellation signal is present', async (context) => {
  const controller = new AbortController();
  context.mock.method(
    globalThis,
    'fetch',
    async (_input: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => reject(new Error('synthetic timeout')),
          { once: true },
        );
      }),
  );
  try {
    const result = await callProvider(
      apiRequest('openai', { signal: controller.signal, timeoutMs: 20 }),
    );
    assert.equal(result.errorKind, 'timeout');
    assert.match(result.error!, /timed out/);
    assert(!controller.signal.aborted);
  } finally {
    context.mock.restoreAll();
  }
});

for (const provider of ['openai', 'anthropic', 'gemini'] as const) {
  for (const missing of [false, true]) {
    test(`${provider} marks valid JSON with ${missing ? 'missing' : 'incomplete'} finish reason as partial`, async (context) => {
      const f = fixture();
      f.write('first.ts', 'export const value = 1;');
      const body =
        provider === 'openai'
          ? {
              choices: [
                {
                  message: { content: JSON.stringify(clean) },
                  finish_reason: missing ? undefined : 'length',
                },
              ],
            }
          : provider === 'anthropic'
            ? {
                content: [{ type: 'text', text: JSON.stringify(clean) }],
                stop_reason: missing ? undefined : 'max_tokens',
              }
            : {
                candidates: [
                  {
                    content: { parts: [{ text: JSON.stringify(clean) }] },
                    finishReason: missing ? undefined : 'MAX_TOKENS',
                  },
                ],
              };
      context.mock.method(
        globalThis,
        'fetch',
        async () => new Response(JSON.stringify(body), { status: 200 }),
      );
      try {
        const result = await new Reviewer({
          ...f.cfg,
          aiProvider: provider,
          apiKey: 'SYNTHETIC_TEST_KEY',
        }).reviewFilesSeparately(f.repo, ['first.ts']);
        assert.equal(result.report.review.status, 'partial');
        assert(
          result.report.review.incomplete_reasons?.includes(
            'response-incomplete',
          ),
        );
      } finally {
        context.mock.restoreAll();
        f.cleanup();
      }
    });
  }
}

test('legacy and advisory enforcement handle P3, model blocking and incomplete states independently', () => {
  for (const status of [
    undefined,
    'completed',
    'partial',
    'failed',
    'cancelled',
  ] as const) {
    for (const issue of [{ file_comments: [comment] }, { blocking: true }]) {
      const result = report({ status, ...issue });
      assert.equal(
        resolveExitCode(result),
        status === 'failed' || status === 'cancelled' ? 0 : 1,
      );
      assert.equal(resolveExitCode(result, 'advisory'), 0);
    }
  }
  assert.equal(
    resolveExitCode(report({ is_error: true, file_comments: [comment] })),
    0,
  );
  assert.equal(resolveExitCode(report({ status: 'partial' })), 0);
});

for (const partial of [false, true]) {
  test(`actual hook displays ${partial ? 'partial blocking review' : 'failed allowed review'} without a PASS label`, () => {
    const f = setup(
      [partial ? { raw: JSON.stringify(defect).slice(0, -1) } : { fail: true }],
      ['first.ts'],
    );
    try {
      f.git('add', 'first.ts');
      f.write('.commit-defender/hook.json', JSON.stringify(f.cfg));
      const result = spawnSync(
        process.execPath,
        [path.resolve('out/hook-cli.js'), f.repo],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, partial ? 1 : 0);
      assert(
        result.stderr.includes(`Review: ${partial ? 'PARTIAL' : 'FAILED'}`),
      );
      assert(
        result.stderr.includes(
          `Legacy hook: ${partial ? 'BLOCKED' : 'ALLOWED'}`,
        ),
      );
      assert(!result.stderr.includes('PASS'));
    } finally {
      f.cleanup();
    }
  });
}
