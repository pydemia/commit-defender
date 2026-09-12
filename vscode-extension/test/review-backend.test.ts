import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  createLegacyReviewBackend,
  type PreparedExecution,
} from "../src/reviewBackend.js";
import {
  ReviewExecutionOwner,
  type ExecutionCallbacks,
} from "../src/reviewExecution.js";
import type { RunResult, CommitMessageResult } from "../src/types.js";
import { fixture } from "./helpers/review-fixture.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function pendingJob(key: string, backendId = "legacy") {
  const gate = deferred<number>();
  let signal!: AbortSignal;
  let progress!: (index: number, total: number, file: string) => void;
  let calls = 0;
  const job: PreparedExecution<number> = {
    key,
    backendId,
    run: (abort, notify) => {
      calls++;
      signal = abort;
      progress = notify!;
      return gate.promise;
    },
  };
  return {
    job,
    gate,
    calls: () => calls,
    signal: () => signal,
    progress: () => progress,
  };
}
function callbacks<T>(events: string[], label: string): ExecutionCallbacks<T> {
  return {
    started: () => events.push(`${label}:start`),
    progress: () => events.push(`${label}:progress`),
    result: () => {
      events.push(`${label}:result`);
    },
    error: () => events.push(`${label}:error`),
    finished: () => events.push(`${label}:finish`),
  };
}
const flush = () => Promise.resolve();
function provider(f: ReturnType<typeof fixture>, commit = false) {
  fs.writeFileSync(
    f.executable,
    `#!/usr/bin/env node
const fs = require('node:fs'); let text = '';
process.stdin.on('data', chunk => text += chunk);
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(f.capture)}, JSON.stringify({text, args:process.argv.slice(2)})+'\\n');
  process.stdout.write(JSON.stringify(${JSON.stringify(commit ? { commit_message: "[Fix] Preserve source snapshot" } : { summary: "Synthetic review.", blocking: false, grade: "proficient", file_comments: [] })}));
});\n`,
  );
}
const calls = (f: ReturnType<typeof fixture>) =>
  fs.existsSync(f.capture)
    ? fs
        .readFileSync(f.capture, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];

test("an asynchronous duplicate joins the captured execution and releases its unused worker", async () => {
  const owner = new ReviewExecutionOwner<number>();
  const events: string[] = [];
  const original = pendingJob("captured", "standalone");
  const first = owner.start(original.job, callbacks(events, "original"));
  await flush();
  let released = false;
  const duplicate = pendingJob("captured", "standalone");
  duplicate.job.dispose = () => {
    released = true;
  };
  const second = owner.prepare(
    async () => duplicate.job,
    callbacks(events, "duplicate"),
  );
  await flush();
  await flush();
  assert(!original.signal().aborted);
  assert.equal(duplicate.calls(), 0);
  original.gate.resolve(1);
  await Promise.all([first, second]);
  await owner.settled();
  assert(released);
  assert.deepEqual(events, [
    "original:start",
    "original:result",
    "original:finish",
  ]);
});

test("clear or superseding preparation releases late snapshots without starting their executors", async () => {
  const owner = new ReviewExecutionOwner<number>();
  const events: string[] = [];
  const firstPrepared = deferred<PreparedExecution<number>>();
  const first = pendingJob("old");
  let released = 0;
  first.job.dispose = () => {
    released++;
  };
  let firstSignal!: AbortSignal;
  const a = owner.prepare(
    (signal) => {
      firstSignal = signal;
      return firstPrepared.promise;
    },
    callbacks(events, "old"),
  );
  const secondPrepared = deferred<PreparedExecution<number>>();
  const second = pendingJob("new");
  second.job.dispose = () => {
    released++;
  };
  const b = owner.prepare(
    () => secondPrepared.promise,
    callbacks(events, "new"),
  );
  assert.equal(firstSignal.reason, "superseded");
  owner.invalidate();
  assert(!owner.isRunning);
  firstPrepared.resolve(first.job);
  secondPrepared.resolve(second.job);
  await Promise.all([a, b]);
  await owner.settled();
  assert.equal(released, 2);
  assert.equal(first.calls() + second.calls(), 0);
  assert.deepEqual(events, []);
});

test("shutdown waits for the worker release acknowledgment after a run resolves", async () => {
  const owner = new ReviewExecutionOwner<number>();
  const events: string[] = [];
  const job = pendingJob("cleanup");
  const release = deferred<void>();
  job.job.dispose = () => release.promise;
  const run = owner.start(job.job, callbacks(events, "run"));
  await flush();
  job.gate.resolve(1);
  await flush();
  await flush();
  let settled = false;
  const shutdown = owner.settled().then(() => {
    settled = true;
  });
  await flush();
  assert(!settled);
  release.resolve();
  await Promise.all([run, shutdown]);
  assert(settled);
});

test("identical in-flight requests join one execution and publish exactly once", async () => {
  const owner = new ReviewExecutionOwner<number>();
  const events: string[] = [];
  const job = pendingJob("same");
  const first = owner.start(job.job, callbacks(events, "first"));
  const second = owner.start(job.job, callbacks(events, "duplicate"));
  assert.equal(first, second);
  await flush();
  assert.equal(job.calls(), 1);
  job.gate.resolve(1);
  await first;
  assert.deepEqual(events, ["first:start", "first:result", "first:finish"]);
  assert(!owner.isRunning);
});

test("superseded execution cannot publish progress, history, results, errors or idle state over the latest run", async () => {
  const owner = new ReviewExecutionOwner<number>();
  const events: string[] = [];
  const old = pendingJob("old");
  const current = pendingJob("new");
  const first = owner.start(old.job, callbacks(events, "old"));
  await flush();
  const second = owner.start(current.job, callbacks(events, "new"));
  await flush();
  assert.equal(old.signal().reason, "superseded");
  old.progress()(1, 1, "old.ts");
  current.progress()(1, 1, "new.ts");
  old.gate.resolve(1);
  await first;
  assert(owner.isRunning);
  current.gate.resolve(2);
  await second;
  assert.deepEqual(events, [
    "old:start",
    "new:start",
    "new:progress",
    "new:result",
    "new:finish",
  ]);
  const late = pendingJob("late");
  const third = owner.start(late.job, callbacks(events, "late"));
  await flush();
  const done = pendingJob("done");
  const fourth = owner.start(done.job, callbacks(events, "done"));
  await flush();
  done.gate.resolve(4);
  await fourth;
  late.gate.reject(new Error("late provider error"));
  await third;
  assert(!events.includes("late:error"));
  assert(!events.includes("late:finish"));
});

test("backend identity is part of ownership and clear prevents a non-cooperative late result from restoring findings", async () => {
  const owner = new ReviewExecutionOwner<number>();
  const events: string[] = [];
  const legacy = pendingJob("same", "legacy");
  const next = pendingJob("same", "next-backend");
  const first = owner.start(legacy.job, callbacks(events, "legacy"));
  await flush();
  const second = owner.start(next.job, callbacks(events, "next"));
  await flush();
  assert.equal(next.calls(), 1);
  assert(legacy.signal().aborted);
  owner.invalidate();
  assert.equal(next.signal().reason, "cleared");
  assert(!owner.isRunning);
  legacy.gate.resolve(1);
  next.gate.resolve(2);
  await Promise.all([first, second]);
  assert.deepEqual(events, ["legacy:start", "next:start"]);
});

test("user cancellation retains the latest cancelled result and an identical retry creates a new execution", async () => {
  const owner = new ReviewExecutionOwner<number>();
  const events: string[] = [];
  const first = pendingJob("same");
  const run = owner.start(first.job, callbacks(events, "cancelled"));
  await flush();
  owner.cancel();
  assert.equal(first.signal().reason, "user");
  assert(owner.isRunning);
  first.gate.resolve(1);
  await run;
  assert(events.includes("cancelled:result"));
  const again = pendingJob("same");
  const retry = owner.start(again.job, callbacks(events, "retry"));
  await flush();
  assert.equal(again.calls(), 1);
  assert(!again.signal().aborted);
  again.gate.resolve(2);
  await retry;
});

test("an old timeout is removed on supersession and timeout reaches only the current backend", async () => {
  const owner = new ReviewExecutionOwner<number>();
  const events: string[] = [];
  const old = pendingJob("old");
  const next = pendingJob("new");
  const first = owner.start(old.job, callbacks(events, "old"), 10);
  await flush();
  const second = owner.start(next.job, callbacks(events, "new"), 60);
  await flush();
  await delay(25);
  assert(!next.signal().aborted);
  await delay(55);
  assert.equal(next.signal().reason, "timeout");
  next.gate.resolve(2);
  old.gate.resolve(1);
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    "old:start",
    "new:start",
    "new:result",
    "new:finish",
  ]);
});

test("async result UI receives a live ownership check before navigating after a newer request", async () => {
  const owner = new ReviewExecutionOwner<number>();
  const ui = deferred<void>();
  const events: string[] = [];
  const old = pendingJob("old");
  const first = owner.start(old.job, {
    ...callbacks(events, "old"),
    result: async (_value, isCurrent) => {
      await ui.promise;
      if (isCurrent()) events.push("old:navigate");
    },
  });
  await flush();
  old.gate.resolve(1);
  await flush();
  const next = pendingJob("new");
  const second = owner.start(next.job, callbacks(events, "new"));
  await flush();
  ui.resolve();
  await first;
  next.gate.resolve(2);
  await second;
  assert(!events.includes("old:navigate"));
  assert(!events.includes("old:finish"));
});

test("backend preparation freezes source, Skill and provider config and duplicate requests call the actual CLI once", async () => {
  const f = fixture();
  try {
    f.cfg.model = "SYNTHETIC_ORIGINAL_MODEL";
    provider(f);
    f.write("source.ts", "export const ORIGINAL_SOURCE = 1;");
    f.write(".commit-defender/rules/SKILL.md", "SYNTHETIC_ORIGINAL_SKILL");
    const backend = createLegacyReviewBackend(f.cfg);
    const request = {
      repoRoot: f.repo,
      files: ["source.ts"],
      scope: "file" as const,
    };
    const prepared = backend.prepareReview(request);
    const same = backend.prepareReview(request);
    assert.equal(prepared.key, same.key);
    assert.equal(prepared.backendId, "legacy");
    assert.match(prepared.key, /^[a-f0-9]{64}$/);
    f.write("source.ts", "export const CHANGED_SOURCE = 2;");
    f.write(".commit-defender/rules/SKILL.md", "SYNTHETIC_CHANGED_SKILL");
    f.cfg.model = "SYNTHETIC_CHANGED_MODEL";
    f.cfg.excludePatterns.push("*");
    request.files[0] = ".env";
    const owner = new ReviewExecutionOwner<RunResult>();
    const outputs: RunResult[] = [];
    const cb = {
      result: (value: RunResult) => {
        outputs.push(value);
      },
      error: (error: unknown) => {
        throw error;
      },
    };
    const first = owner.start(prepared, cb);
    const second = owner.start(same, cb);
    assert.equal(first, second);
    await first;
    const invoked = calls(f);
    assert.equal(invoked.length, 1);
    assert.equal(outputs.length, 1);
    assert.deepEqual(outputs[0].report.staged_files, ["source.ts"]);
    assert.equal(outputs[0].report.review.status, "completed");
    assert(invoked[0].text.includes("ORIGINAL_SOURCE"));
    assert(!invoked[0].text.includes("CHANGED_SOURCE"));
    assert(invoked[0].text.includes("SYNTHETIC_ORIGINAL_SKILL"));
    assert(!invoked[0].text.includes("SYNTHETIC_CHANGED_SKILL"));
    assert(invoked[0].args.includes("SYNTHETIC_ORIGINAL_MODEL"));
    assert(!invoked[0].args.includes("SYNTHETIC_CHANGED_MODEL"));
    const changed = backend.prepareReview({
      repoRoot: f.repo,
      files: ["source.ts"],
      scope: "file",
    });
    assert.notEqual(changed.key, prepared.key);
  } finally {
    f.cleanup();
  }
});

test("request identity distinguishes scope, settings, Skill and changed content; staged execution uses its prepared Git tree", async () => {
  const f = fixture();
  try {
    provider(f);
    f.write("source.ts", "const BASE = 1;");
    f.git("add", ".");
    f.git("commit", "-m", "base");
    f.write("source.ts", "const STAGED = 2;");
    f.git("add", "source.ts");
    const request = {
      repoRoot: f.repo,
      files: ["source.ts"],
      scope: "staged" as const,
    };
    const backend = createLegacyReviewBackend(f.cfg);
    const prepared = backend.prepareReview(request);
    assert.notEqual(
      backend.prepareReview({ ...request, scope: "file" }).key,
      prepared.key,
    );
    assert.notEqual(
      createLegacyReviewBackend({ ...f.cfg, model: "other" }).prepareReview(
        request,
      ).key,
      prepared.key,
    );
    f.write(".commit-defender/rules/SKILL.md", "new criterion");
    assert.notEqual(backend.prepareReview(request).key, prepared.key);
    f.write("source.ts", "const LATER_INDEX = 3;");
    f.git("add", "source.ts");
    assert.notEqual(backend.prepareReview(request).key, prepared.key);
    const result = await prepared.run(new AbortController().signal);
    assert.equal(result.report.review.status, "completed");
    assert.equal(result.report.source_snapshot?.kind, "index");
    assert(calls(f)[0].text.includes("+const STAGED = 2;"));
    assert(!calls(f)[0].text.includes("LATER_INDEX"));
  } finally {
    f.cleanup();
  }
});

test("a captured input failure is retained if the repository is repaired before execution, with no provider fallback", async () => {
  const f = fixture();
  try {
    provider(f);
    f.write("source.ts", "const value = 1;");
    f.git("add", ".");
    const index = path.join(f.repo, ".git", "index");
    const bytes = fs.readFileSync(index);
    fs.writeFileSync(index, "bad index");
    const prepared = createLegacyReviewBackend(f.cfg).prepareReview({
      repoRoot: f.repo,
      files: ["source.ts"],
      scope: "staged",
    });
    fs.writeFileSync(index, bytes);
    const result = await prepared.run(new AbortController().signal);
    assert.equal(result.report.review.status, "failed");
    assert(result.report.review.incomplete_reasons?.includes("source-error"));
    assert.equal(calls(f).length, 0);
  } finally {
    f.cleanup();
  }
});

test("commit-message preparation uses a separate operation identity and one frozen diff per shared execution", async () => {
  const f = fixture();
  try {
    provider(f, true);
    f.write("source.ts", "const STAGED = 2;");
    f.git("add", ".");
    const backend = createLegacyReviewBackend(f.cfg);
    const prepared = backend.prepareCommitMessage(f.repo);
    assert.notEqual(
      prepared.key,
      backend.prepareReview({
        repoRoot: f.repo,
        files: ["source.ts"],
        scope: "staged",
      }).key,
    );
    const same = backend.prepareCommitMessage(f.repo);
    assert.equal(same.key, prepared.key);
    f.write("source.ts", "const LATER_INDEX = 3;");
    f.git("add", "source.ts");
    assert.notEqual(backend.prepareCommitMessage(f.repo).key, prepared.key);
    const owner = new ReviewExecutionOwner<CommitMessageResult>();
    const output: CommitMessageResult[] = [];
    const cb = {
      result: (value: CommitMessageResult) => {
        output.push(value);
      },
      error: (error: unknown) => {
        throw error;
      },
    };
    const first = owner.start(prepared, cb);
    const second = owner.start(same, cb);
    await Promise.all([first, second]);
    assert.equal(output.length, 1);
    assert.equal(output[0].is_error, false);
    assert.equal(calls(f).length, 1);
    assert(calls(f)[0].text.includes("STAGED = 2"));
    assert(!calls(f)[0].text.includes("LATER_INDEX"));
  } finally {
    f.cleanup();
  }
});
