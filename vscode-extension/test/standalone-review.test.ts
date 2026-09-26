import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  contentHash,
  discoverLocalIdentity,
  LocalHistoryStore,
  LocalKnowledgeStore,
  LocalRecordStore,
  ReviewRequests,
  observeAutomaticRepository,
  observeAutomaticFile,
  type LocalKeyStore,
  type LocalReviewExecutor,
} from "@gcr/client-core";
import {
  type ClientReviewReport,
  type LocalReviewResponse,
} from "@gcr/client-contract";
import { prepareStandaloneReview } from "../src/standaloneReview.js";
import {
  standaloneError,
  type StandaloneReviewSettings,
} from "../src/standaloneReviewProtocol.js";
import { prepareStandaloneWorker } from "../src/standaloneWorkerClient.js";
import {
  readRecordedSource,
  retainCapturedSources,
  sourceViews,
} from "../src/reviewSource.js";
import { fixture } from "./helpers/review-fixture.js";
import {
  checkLocalContextFreshness,
  saveKnowledgeFromEditor,
  withLocalKnowledge,
  readLocalHistory,
} from "../src/localKnowledge.js";
import {
  knowledgeEditorChanges,
  knowledgeEditorValues,
  localKnowledgeHtml,
} from "../src/localKnowledgeEditor.js";

const settings: StandaloneReviewSettings = {
  mode: "standalone",
  profileId: "cd-test",
  provider: "codex",
  model: "gpt-6-astra",
  reasoningEffort: "xhigh",
  executablePath: "codex",
  workspaceTrusted: true,
  durationMs: 120_000,
  excludePatterns: [],
};
function keys(): LocalKeyStore {
  const entries = new Map<string, Buffer>();
  return {
    async read(id) {
      const key = entries.get(id);
      return key && Buffer.from(key);
    },
    async write(id, key) {
      entries.set(id, Buffer.from(key));
    },
    async remove(id) {
      entries.delete(id);
    },
  };
}
function setup(t: test.TestContext) {
  const f = fixture();
  t.after(f.cleanup);
  f.write(
    "sum.ts",
    "export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);\n",
  );
  f.git("add", ".");
  f.git("commit", "-m", "base");
  f.write(
    "sum.ts",
    "export const sum = (values: number[]) => values.reduce((a, b) => a + b);\n",
  );
  f.git("add", ".");
  const client = discoverLocalIdentity(f.repo, settings.profileId);
  const scope = {
    kind: "repository" as const,
    profileId: client.profileId,
    repositoryKey: client.repositoryKey,
    worktreeKey: client.worktreeKey,
  };
  const dataDirectory = path.join(f.root, "encrypted");
  const keyStore = keys();
  const request = {
    repoRoot: f.repo,
    files: ["sum.ts"],
    scope: "staged" as const,
  };
  return { ...f, client, scope, dataDirectory, keyStore, request };
}
const descriptor: LocalReviewExecutor["descriptor"] = {
  id: "fixture",
  version: "1",
  model: "gpt-6-astra",
  configHash: contentHash("synthetic-CD-port"),
  capabilities: {
    available: true,
    sourceIsolation: "fixed-source-only",
    cancellation: true,
    timeout: true,
    childProcessCleanup: true,
    outputTokenLimit: false,
  },
};
async function answer(input: Parameters<LocalReviewExecutor["review"]>[0]) {
  const reads = await Promise.all(
    ["source", "base"].map(async (side) =>
      JSON.parse(
        await input.source.execute("read_file", { path: "sum.ts", side }),
      ),
    ),
  );
  const response: LocalReviewResponse = {
    summary: "Synthetic fixed-source review.",
    files: [
      {
        path: "sum.ts",
        side: "source",
        complete: true,
        summary: "Source and base examined.",
        readIds: reads.map((read) => read.readId),
      },
    ],
    findings: [],
    questions: [],
  };
  return { reads, response };
}
const abort = () => new AbortController().signal;

for (const failure of ["history", "request"] as const) {
  test(`a ${failure} persistence failure cannot acknowledge automatic completion`, async t => {
    const f = setup(t);
    const reject = async () => { throw Error("Injected persistence failure"); };
    if (failure === "history") t.mock.method(LocalHistoryStore.prototype, "saveReview", reject);
    else t.mock.method(ReviewRequests.prototype, "finish", reject);
    const prepared = await prepareStandaloneReview(f.request, settings, abort(), {
      dataDirectory: f.dataDirectory, keys: f.keyStore,
      prepareExecutor: async () => ({ descriptor, review: async input => ({ model: descriptor.model, raw: JSON.stringify((await answer(input)).response) }) }),
    });
    try {
      const result = await prepared.run(abort());
      assert.equal(result.report.gcr?.report.status, "completed");
      assert.equal(result.reviewCompletionConfirmed, false);
      assert.match(result.stderr, /could not be confirmed/);
    } finally { await prepared.dispose?.(); }
  });
}

test("an empty profile has no history and does not create an OS key or storage on sidebar load", async (t) => {
  const f = setup(t);
  let keyReads = 0;
  const empty = await readLocalHistory(
    { profileId: settings.profileId, repoRoot: f.repo, scope: "repository" },
    {
      dataDirectory: f.dataDirectory,
      keys: {
        async read() {
          keyReads++;
          throw Error("unexpected key read");
        },
        async write() {
          throw Error("unexpected write");
        },
        async remove() {},
      },
    },
  );
  assert.deepEqual(empty, []);
  assert.equal(keyReads, 0);
  assert(!fs.existsSync(f.dataDirectory));
});

test("the editor save service preserves scope and rejects a stale revision without overwriting a concurrent change", async (t) => {
  const f = setup(t);
  const ports = { dataDirectory: f.dataDirectory, keys: f.keyStore };
  const values = {
    title: "Caller contract",
    body: "Empty input returns zero.",
    paths: "sum.ts",
    languages: "",
    symbols: "",
    branches: "",
    rationale: "Caller passes an empty array.",
    counterEvidence: "",
    expiresAt: "",
  };
  const candidate = await saveKnowledgeFromEditor(
    f.scope,
    "memory",
    values,
    undefined,
    ports,
  );
  assert.equal(candidate.state, "candidate");
  const active = await withLocalKnowledge(
    f.scope,
    (store) => store.setState(candidate.id, 1, "active"),
    ports,
  );
  await assert.rejects(
    saveKnowledgeFromEditor(
      f.scope,
      "memory",
      { ...values, body: "Stale edit" },
      candidate,
      ports,
    ),
    (error) =>
      !!error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "revision-conflict",
  );
  assert.deepEqual(
    await withLocalKnowledge(f.scope, (store) => store.get(active.id), ports),
    active,
  );
  const updated = await saveKnowledgeFromEditor(
    f.scope,
    "memory",
    { ...values, body: "Updated caller contract" },
    active,
    ports,
  );
  assert.equal(updated.revision, 3);
  assert.equal(updated.state, "active");
  await assert.rejects(
    saveKnowledgeFromEditor(
      { kind: "profile", profileId: "different-profile" },
      "memory",
      values,
      updated,
      ports,
    ),
    /scope/,
  );
  const skill = await saveKnowledgeFromEditor(
    f.scope,
    "skill",
    values,
    undefined,
    ports,
  );
  assert(
    skill.kind === "skill" &&
      skill.reviewOnly &&
      skill.origin === "user-authored",
  );
});

test("standalone review keeps the staged source immutable and reloads the full report from encrypted history", async (t) => {
  const f = setup(t);
  let observed = "";
  const prepared = await prepareStandaloneReview(f.request, settings, abort(), {
    dataDirectory: f.dataDirectory,
    keys: f.keyStore,
    prepareExecutor: async () => ({
      descriptor,
      review: async (input) => {
        const { reads, response } = await answer(input);
        observed = reads[0].text;
        return { raw: JSON.stringify(response), model: descriptor.model };
      },
    }),
  });
  f.write("sum.ts", "UNSTAGED AFTER PREPARATION\n");
  f.git("add", ".");
  const result = await prepared.run(abort());
  const report = (
    result.report as typeof result.report & {
      gcr: { report: ClientReviewReport };
    }
  ).gcr.report;
  assert.equal(report.status, "completed");
  assert(observed.includes("values.reduce((a, b) => a + b)"));
  assert(!observed.includes("UNSTAGED"));
  assert.equal(result.report.review.blocking, false);
  assert.equal(result.report.review.grade, "");
  assert.equal(result.stderr, "");
  assert.equal(report.evidence.length, 2);
  assert.equal(result.capturedSources?.["sum.ts"], observed);
  assert.equal(
    sourceViews.get(result.report.source_anchors!["sum.ts"].sha256),
    undefined,
  );
  retainCapturedSources(result.report, { "sum.ts": "unverified body" });
  assert.equal(
    sourceViews.get(result.report.source_anchors!["sum.ts"].sha256),
    undefined,
  );
  retainCapturedSources(result.report, result.capturedSources);
  assert.equal(readRecordedSource(f.repo, result.report, "sum.ts"), observed);
  assert(!JSON.stringify(report).includes(observed));
  const records = await LocalRecordStore.open({
    scope: f.scope,
    dataDirectory: f.dataDirectory,
    keys: f.keyStore,
  });
  try {
    assert.deepEqual(
      await new LocalHistoryStore(records).getReview(report.runId),
      report,
    );
  } finally {
    records.close();
  }
  await assert.rejects(prepared.run(abort()), /released/);
});

test("active local knowledge is pinned at preparation and a later deactivation changes the next execution key", async (t) => {
  const f = setup(t);
  const records = await LocalRecordStore.open({
    scope: f.scope,
    dataDirectory: f.dataDirectory,
    keys: f.keyStore,
  });
  t.after(() => records.close());
  const knowledge = new LocalKnowledgeStore(records);
  const created = await knowledge.create({
    kind: "memory",
    title: "Empty arrays",
    body: "Handle empty arrays.",
    rationale: "Callers may pass no values.",
    counterEvidence: [],
    appliesTo: { paths: [], languages: [], symbols: [], branches: [] },
    sources: [],
  });
  const active = await knowledge.setState(
    created.id,
    created.revision,
    "active",
  );
  const prompts: string[] = [];
  const ports = {
    dataDirectory: f.dataDirectory,
    keys: f.keyStore,
    prepareExecutor: async () => ({
      descriptor,
      review: async (input: Parameters<LocalReviewExecutor["review"]>[0]) => {
        prompts.push(input.prompt);
        return {
          raw: JSON.stringify((await answer(input)).response),
          model: descriptor.model,
        };
      },
    }),
  };
  const first = await prepareStandaloneReview(
    f.request,
    settings,
    abort(),
    ports,
  );
  const duplicate = await prepareStandaloneReview(
    f.request,
    settings,
    abort(),
    ports,
  );
  assert.equal(first.key, duplicate.key);
  duplicate.dispose();
  await knowledge.setState(active.id, active.revision, "inactive");
  const second = await prepareStandaloneReview(
    f.request,
    settings,
    abort(),
    ports,
  );
  assert.notEqual(first.key, second.key);
  const firstResult = await first.run(abort());
  const freshness = await checkLocalContextFreshness(
    firstResult.report.gcr!.report,
    ports,
  );
  assert.equal(freshness.status, "stale");
  assert.deepEqual(freshness.changes, [{ id: active.id, reason: "inactive" }]);
  await second.run(abort());
  assert(prompts[0].includes("Handle empty arrays."));
  assert(!prompts[1].includes("Handle empty arrays."));
});

test("the knowledge editor escapes stored text, prevents inline execution and validates editable fields", () => {
  const payload =
    '</textarea><script>fetch("https://invalid.example/private")</script>';
  const html = localKnowledgeHtml(
    "a".repeat(32),
    payload,
    [],
    undefined,
    "memory",
    payload,
  );
  assert(!html.includes(payload));
  assert(html.includes("&lt;/textarea&gt;"));
  assert(html.includes("default-src 'none'"));
  assert(!html.includes("localStorage") && !html.includes("setState("));
  assert.throws(() => knowledgeEditorValues({ body: "body" }));
  const fields = {
    title: "Title",
    body: payload,
    paths: "src/**\n",
    languages: "typescript\n",
    symbols: "",
    branches: "main",
    rationale: "Source assumption",
    counterEvidence: "Caller accepts empty input\n",
    expiresAt: "2026-12-31T23:59:59.000Z",
  };
  const edit = knowledgeEditorChanges(knowledgeEditorValues(fields), "memory");
  assert.equal(edit.body, payload);
  assert.deepEqual(edit.appliesTo?.paths, ["src/**"]);
  assert.deepEqual(edit.counterEvidence, ["Caller accepts empty input"]);
  assert.throws(() =>
    knowledgeEditorValues({
      ...fields,
      scope: { kind: "profile", profileId: "another" },
    }),
  );
  assert.throws(() =>
    knowledgeEditorChanges({ ...fields, expiresAt: "tomorrow" }, "skill"),
  );
});

test("worker results resolve only after cleanup exit; disposing an unused preparation acknowledges exit", async (t) => {
  const f = setup(t);
  const workerFile = path.join(f.root, "worker.cjs");
  fs.writeFileSync(
    workerFile,
    `
    const {parentPort,workerData}=require('node:worker_threads');
    const fs=require('node:fs');
    parentPort.postMessage({type:'prepared',key:'synthetic',backendId:'standalone'});
    parentPort.on('message', message=>{
      if(message.type==='run') {
        parentPort.postMessage({type:'result',result:{synthetic:true}});
        setTimeout(()=>{fs.writeFileSync(workerData.request.repoRoot+'/cleanup-proof','done');parentPort.close();},50);
      } else if(message.type==='dispose') {
        fs.writeFileSync(workerData.request.repoRoot+'/dispose-proof','done');parentPort.close();
      }
    });
  `,
  );
  const prepared = await prepareStandaloneWorker(
    workerFile,
    f.request,
    settings,
    abort(),
  );
  const value = await prepared.run(abort());
  assert.deepEqual(value, { synthetic: true });
  assert.equal(
    fs.readFileSync(path.join(f.repo, "cleanup-proof"), "utf8"),
    "done",
  );
  const idle = await prepareStandaloneWorker(
    workerFile,
    f.request,
    settings,
    abort(),
  );
  await idle.dispose?.();
  assert.equal(
    fs.readFileSync(path.join(f.repo, "dispose-proof"), "utf8"),
    "done",
  );
  await assert.rejects(idle.run(abort()), /released/);
});

test("cancelled, timed-out and invalid model output remain distinct terminal reports in history without a provider fallback", async (t) => {
  const f = setup(t);
  let calls = 0;
  const ports = {
    dataDirectory: f.dataDirectory,
    keys: f.keyStore,
    prepareExecutor: async () => ({
      descriptor,
      review: async () => {
        calls++;
        return {
          raw: "invalid response WITH PRIVATE PROVIDER TEXT",
          model: descriptor.model,
        };
      },
    }),
  };
  const invalid = await prepareStandaloneReview(
    f.request,
    settings,
    abort(),
    ports,
  );
  const failed = await invalid.run(abort());
  assert.equal(failed.report.review.status, "failed");
  const problem = failed.report.gcr?.report.problems[0];
  assert.equal(problem?.code, "invalid-output");
  assert.match(problem?.message ?? "", /\(invalid-json\)/);
  assert.equal(calls, 1);
  assert(!JSON.stringify(failed).includes("PRIVATE PROVIDER TEXT"));
  const pending = await prepareStandaloneReview(
    f.request,
    settings,
    abort(),
    ports,
  );
  const controller = new AbortController();
  controller.abort("user");
  const cancelled = await pending.run(controller.signal);
  assert.equal(cancelled.report.review.status, "cancelled");
  assert.equal(calls, 1);
  const expired = await prepareStandaloneReview(
    f.request,
    settings,
    abort(),
    ports,
  );
  const deadline = new AbortController();
  deadline.abort("timeout");
  const timedOut = await expired.run(deadline.signal);
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.cancelled, false);
  assert.equal(timedOut.report.review.status, "failed");
  assert.equal(timedOut.report.gcr?.report.problems[0]?.code, "timeout");
  assert.equal(calls, 1);
  const records = await LocalRecordStore.open({
    scope: f.scope,
    dataDirectory: f.dataDirectory,
    keys: f.keyStore,
  });
  try {
    const history = await new LocalHistoryStore(records).listReviews();
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.find((report) => report.runId === failed.report.gcr?.report.runId)
        ?.problems,
      failed.report.gcr?.report.problems,
    );
    assert.deepEqual(
      history.find(
        (report) => report.runId === timedOut.report.gcr?.report.runId,
      )?.problems,
      timedOut.report.gcr?.report.problems,
    );
    assert(!JSON.stringify(history).includes("PRIVATE PROVIDER TEXT"));
  } finally {
    records.close();
  }
});

test("unsupported mode/provider/model and an untrusted workspace stop before source, storage or executor access", async () => {
  let accessed = 0;
  for (const override of [
    { mode: "centralized" },
    { provider: "openai" },
    { model: "unknown" },
    { reasoningEffort: "high" },
    { workspaceTrusted: false },
  ]) {
    await assert.rejects(
      prepareStandaloneReview(
        { repoRoot: "/nonexistent", files: ["a.ts"], scope: "file" },
        { ...settings, ...override },
        abort(),
        {
          prepareExecutor: async () => {
            accessed++;
            throw Error("unexpected");
          },
        },
      ),
    );
  }
  assert.equal(accessed, 0);
  const safe = standaloneError({
    code: "bad-private-code",
    message: "secret source and credentials",
  });
  assert(!safe.message.includes("secret"));
  assert.equal(safe.code, "preparation-failed");
  for (const code of ["insecure-storage", "storage-unavailable",
    "unsupported-platform", "corrupt-storage", "commit-unknown"]) {
    const failure = standaloneError({ code, message: "private credential" });
    assert.equal(failure.code, code);
    assert(!failure.message.includes("private credential"));
  }
});

test("context preparation diagnostics distinguish budget and validation failures without private details", () => {
  for (const [code, text] of [
    ["context-budget-exceeded", "exceed the context budget"],
    ["context-validation-failed", "could not be verified or loaded"],
  ]) {
    const failure = standaloneError({
      code,
      message: "private credential and source",
    });
    assert.equal(failure.code, code);
    assert(failure.message.includes(text));
    assert(failure.message.includes("No model request was made"));
    assert(!failure.message.includes("private credential"));
  }
});

test("a cancelled preparation releases its stores and never invokes the executor", async (t) => {
  const f = setup(t);
  const controller = new AbortController();
  controller.abort("timeout");
  await assert.rejects(
    prepareStandaloneReview(f.request, settings, controller.signal),
    (error) =>
      !!error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "timeout",
  );
  assert(!fs.existsSync(f.dataDirectory));
});

test("the packaged worker fails unsupported configuration without freezing the host or leaking raw diagnostics", async (t) => {
  const f = setup(t);
  const workerFile = path.resolve("out/standalone-review-worker.js");
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  try {
    await assert.rejects(
      prepareStandaloneWorker(
        workerFile,
        f.request,
        { ...settings, provider: "unsupported" },
        abort(),
      ),
      /does not yet support/,
    );
    assert(ticks > 0);
  } finally {
    clearInterval(timer);
  }
});

test("independent preparations share one model review and encrypted history for identical input", async (t) => {
  const f = setup(t);
  let calls = 0;
  const ports = {
    dataDirectory: f.dataDirectory,
    keys: f.keyStore,
    prepareExecutor: async () => ({
      descriptor,
      review: async (input: Parameters<LocalReviewExecutor["review"]>[0]) => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          raw: JSON.stringify((await answer(input)).response),
          model: descriptor.model,
        };
      },
    }),
  };
  const first = await prepareStandaloneReview(
    f.request,
    settings,
    abort(),
    ports,
  );
  const second = await prepareStandaloneReview(
    f.request,
    settings,
    abort(),
    ports,
  );
  assert.equal(first.key, second.key);
  const results = await Promise.all([first.run(abort()), second.run(abort())]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0].report, results[1].report);
  assert(results.every(result => result.reviewCompletionConfirmed === true));
  assert(
    results.some((result) => result.stderr.includes("Reused the saved review")),
  );
  assert.deepEqual(results[0].capturedSources, results[1].capturedSources);
  const third = await prepareStandaloneReview(
    f.request,
    settings,
    abort(),
    ports,
  );
  const reused = await third.run(abort());
  assert.equal(calls, 1);
  assert.deepEqual(reused.report, results[0].report);
});

test("a cancelled follower saves its own attempt without completing the owner's request", async (t) => {
  const f = setup(t);
  let started!: () => void, release!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.after(() => release());
  let calls = 0;
  const ports = {
    dataDirectory: f.dataDirectory,
    keys: f.keyStore,
    prepareExecutor: async () => ({
      descriptor,
      review: async (input: Parameters<LocalReviewExecutor["review"]>[0]) => {
        calls++;
        started();
        await pending;
        assert.equal(input.signal?.aborted, false);
        return {
          raw: JSON.stringify((await answer(input)).response),
          model: descriptor.model,
        };
      },
    }),
  };
  const owner = await prepareStandaloneReview(
    f.request,
    settings,
    abort(),
    ports,
  );
  const follower = await prepareStandaloneReview(
    f.request,
    settings,
    abort(),
    ports,
  );
  const first = owner.run(abort());
  await running;
  const controller = new AbortController();
  const second = follower.run(controller.signal);
  controller.abort("user");
  assert.equal((await second).report.review.status, "cancelled");
  const queue = await ReviewRequests.open({ ...ports, scope: f.scope });
  try {
    assert.equal((await queue.get(owner.key))?.state, "running");
    release();
    const result = await first;
    assert.equal(result.report.review.status, "completed");
    assert.equal(
      (await queue.get(owner.key))?.resultId,
      result.report.gcr?.report.runId,
    );
    assert.equal(calls, 1);
  } finally {
    release();
    await first;
    queue.close();
  }
});

test("automatic Stage records its reason, shares a manual result, and defers new input at the durable budget", async (t) => {
  const f=setup(t);let calls=0;
  const ports={dataDirectory:f.dataDirectory,keys:f.keyStore,prepareExecutor:async()=>({descriptor,review:async(input:Parameters<LocalReviewExecutor['review']>[0])=>{calls++;return{raw:JSON.stringify((await answer(input)).response),model:descriptor.model};}})};
  const observed=await observeAutomaticRepository(f.repo);
  const automatic={reason:'stage' as const,head:observed.head,indexFingerprint:observed.fingerprint,minimumIntervalMs:0,maximumReviewsPerHour:1};
  const job=await prepareStandaloneReview({...f.request,automatic},settings,abort(),ports);
  const result=await job.run(abort());assert.equal(result.report.gcr?.report.trigger,'stage');assert.equal(calls,1);
  const manual=await prepareStandaloneReview(f.request,settings,abort(),ports);assert.deepEqual((await manual.run(abort())).report,result.report);assert.equal(calls,1);
  f.write('sum.ts','export const sum = (values: number[]) => 0;\n');f.git('add','.');
  const next=await observeAutomaticRepository(f.repo);
  const deferred=await prepareStandaloneReview({...f.request,automatic:{...automatic,indexFingerprint:next.fingerprint}},settings,abort(),ports);
  await assert.rejects(deferred.run(abort()),(e:unknown)=>!!e && typeof e==='object' && 'code' in e && e.code==='request-deferred' && 'retryAt' in e && typeof e.retryAt==='number' && e.retryAt>Date.now());assert.equal(calls,1);
});
test("automatic Save verifies observed bytes again before the model starts",async(t)=>{
 const f=setup(t);let calls=0;
 const observed=await observeAutomaticRepository(f.repo),file=await observeAutomaticFile(f.repo,'sum.ts');assert(file);
 const ports={dataDirectory:f.dataDirectory,keys:f.keyStore,prepareExecutor:async()=>({descriptor,review:async(input:Parameters<LocalReviewExecutor['review']>[0])=>{calls++;return{raw:JSON.stringify((await answer(input)).response),model:descriptor.model};}})};
 const job=await prepareStandaloneReview({...f.request,scope:'selection',automatic:{reason:'save',head:observed.head,files:{'sum.ts':file.hash},minimumIntervalMs:600000,maximumReviewsPerHour:6}},settings,abort(),ports);
 f.write('sum.ts','export const changedAfterSave = true;\n');
 await assert.rejects(job.run(abort()),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code==='source-changed');assert.equal(calls,0);
 const latest=await observeAutomaticFile(f.repo,'sum.ts');assert(latest);
 const next=await prepareStandaloneReview({...f.request,scope:'selection',automatic:{reason:'save',head:observed.head,files:{'sum.ts':latest.hash},minimumIntervalMs:600000,maximumReviewsPerHour:6}},settings,abort(),ports);
 const report=await next.run(abort());assert.equal(report.report.gcr?.report.trigger,'save');assert.equal(calls,1);
});
