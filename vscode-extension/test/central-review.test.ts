import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import path from "node:path";
import { CentralSynchronization } from "../src/centralSynchronization.js";
import { contentHash, type LocalReviewExecutor } from "@gcr/client-core";
import { prepareStandaloneReview } from "../src/standaloneReview.js";
import {
  centralSelection,
  readCentralHistory,
  readSelectedHistory,
  readSelection,
  selectedReviewSettings,
  selectionKey,
  withCentralConnection,
  type CentralSelection,
} from "../src/centralConnection.js";
import {
  knowledgeScope,
  readLocalHistory,
  saveKnowledgeFromEditor,
  withLocalKnowledge,
} from "../src/localKnowledge.js";
import { mergeLocalHistory } from "../src/historyEntries.js";
import { type StandaloneReviewSettings } from "../src/standaloneReviewProtocol.js";
import { fixture } from "./helpers/review-fixture.js";
import { centralFixture } from "./helpers/central-fixture.js";

const signal = () => new AbortController().signal;
const defaults: StandaloneReviewSettings = {
  mode: "standalone",
  profileId: "cd-central-test",
  provider: "codex",
  model: "gpt-6-astra",
  reasoningEffort: "xhigh",
  executablePath: "/unused",
  workspaceTrusted: true,
  durationMs: 30000,
  excludePatterns: [],
};
const descriptor: LocalReviewExecutor["descriptor"] = {
  id: "fixture",
  version: "1",
  model: "gpt-6-astra",
  configHash: contentHash("cd-central-synthetic"),
  capabilities: {
    available: true,
    sourceIsolation: "fixed-source-only",
    cancellation: true,
    timeout: true,
    childProcessCleanup: true,
    outputTokenLimit: false,
  },
};
async function response(input: Parameters<LocalReviewExecutor["review"]>[0]) {
  const reads = [];
  for (const side of ["source", "base"])
    reads.push(
      JSON.parse(
        await input.source.execute("read_file", { path: "sum.ts", side }),
      ),
    );
  return {
    model: descriptor.model,
    raw: JSON.stringify({
      summary: "Reviewed fixed source and base",
      files: [
        {
          path: "sum.ts",
          side: "source",
          complete: true,
          summary: "Inspected",
          readIds: reads.map((r) => r.readId),
        },
      ],
      findings: [],
      questions: [],
    }),
  };
}
async function setup(t: TestContext, codeCriterion = false) {
  const f = fixture();
  f.write("sum.ts", "export const sum = (a: number, b: number) => a + b;\n");
  f.git("add", ".");
  f.git("commit", "-m", "base");
  f.write("sum.ts", "export const sum = (a: number, b: number) => a - b;\n");
  f.git("add", "sum.ts");
  const central = await centralFixture(f.root, undefined, codeCriterion);
  t.after(async () => {
    await central.close();
    f.cleanup();
  });
  const location = {
    profileId: defaults.profileId,
    repoRoot: f.repo,
    scope: "repository" as const,
  };
  const scope = knowledgeScope(location);
  if (scope.kind !== "repository") throw Error("scope");
  const ports = {
    dataDirectory: path.join(f.root, "data"),
    keys: central.keys,
    credentials: central.credentials,
  };
  const connected = await withCentralConnection(
    scope,
    (c) => c.connect(central.config, central.secret, "commit-defender"),
    ports,
  );
  const selection: Extract<CentralSelection, { mode: "centralized" }> = {
    version: 1,
    mode: "centralized",
    connectionId: connected.id,
    freshness: "online",
  };
  const settings = selectedReviewSettings(defaults, selection);
  const request = {
    repoRoot: f.repo,
    files: ["sum.ts"],
    scope: "staged" as const,
  };
  return {
    ...f,
    central,
    ports,
    scope,
    location,
    selection,
    settings,
    request,
  };
}

test("explicit worktree selections cannot cross profiles or authorize credentials from settings", () => {
  const scope = {
    kind: "repository" as const,
    profileId: "profile",
    repositoryKey: "a".repeat(64),
    worktreeKey: "b".repeat(64),
  };
  const value = {
    version: 1,
    mode: "centralized",
    connectionId: "c".repeat(64),
    freshness: "offline",
  } as const;
  const entries = new Map([[selectionKey(scope), value]]);
  const store = {
    get<T>(key: string) {
      return entries.get(key) as T | undefined;
    },
    async update() {},
  };
  assert.deepEqual(readSelection(store, scope), value);
  assert.equal(
    readSelection(store, { ...scope, profileId: "other" }),
    undefined,
  );
  assert.equal(
    readSelection(store, { ...scope, worktreeKey: "d".repeat(64) }),
    undefined,
  );
  assert.throws(() => centralSelection({ ...value, apiKey: "secret" }));
  assert.throws(() => centralSelection({ ...value, freshness: "automatic" }));
  assert.throws(() => centralSelection({ ...value, connectionId: "bad" }));
  assert.equal(selectedReviewSettings(defaults).mode, "standalone");
  assert.equal(
    selectedReviewSettings(
      { ...defaults, connectionId: value.connectionId },
      { version: 1, mode: "standalone" },
    ).connectionId,
    undefined,
  );
});

test("connected CD review applies a v3 code-derived criterion with the local executor and restores audience-bound history", async (t) => {
  const f = await setup(t, true);
  const candidate = await saveKnowledgeFromEditor(
    f.scope,
    "memory",
    {
      title: "Personal review",
      body: "CD_LOCAL_MEMORY",
      paths: "sum.ts",
      languages: "",
      symbols: "",
      branches: "",
      rationale: "Personal evidence",
      counterEvidence: "",
      expiresAt: "",
    },
    undefined,
    f.ports,
  );
  await withLocalKnowledge(
    f.scope,
    (store) => store.setState(candidate.id, candidate.revision, "active"),
    f.ports,
  );
  let calls = 0;
  const job = await prepareStandaloneReview(f.request, f.settings, signal(), {
    ...f.ports,
    prepareExecutor: async () => ({
      descriptor,
      async review(input) {
        calls++;
        assert(input.prompt.includes("CD_CENTRAL_POLICY"));
        assert(input.prompt.includes("CD_CODE_CRITERION"));
        assert(input.prompt.includes("CD_LOCAL_MEMORY"));
        return response(input);
      },
    }),
  });
  assert.equal(job.backendId, "centralized");
  assert.equal(calls, 0);
  const result = await job.run(signal());
  const report = result.report.gcr!.report;
  assert.equal(report.status, "completed");
  assert.equal(calls, 1);
  assert(f.central.requestMethods.every(method => method === "GET"));
  assert.equal(f.central.submissionCalls, 0);
  assert.deepEqual(
    report.identity.client.mode === "centralized" &&
      report.identity.client.audience,
    f.central.audience,
  );
  assert.equal(report.evidence.length, 2);
  assert(!JSON.stringify(result).includes(f.central.secret));
  const restored = await readCentralHistory(f.location, f.selection, f.ports);
  assert.deepEqual(restored.reports, [report]);
  assert.deepEqual(await readLocalHistory(f.location, f.ports), []);
  assert.equal(mergeLocalHistory([], [report], f.repo, f.scope).length, 0);
  assert.equal(
    mergeLocalHistory([], [report], f.repo, f.scope, f.central.audience).length,
    1,
  );
  assert.equal(
    mergeLocalHistory([], [report], f.repo, f.scope, {
      ...f.central.audience,
      userId: "bob",
    }).length,
    0,
  );
  assert.equal(
    (
      await withLocalKnowledge(
        f.scope,
        (store) => store.get(candidate.id),
        f.ports,
      )
    )?.body,
    "CD_LOCAL_MEMORY",
  );
});

test("standalone mode makes no central requests even when a connected selection remains", async (t) => {
  const f = await setup(t);
  const before = f.central.calls;
  const job = await prepareStandaloneReview(
    f.request,
    { ...f.settings, mode: "standalone" },
    signal(),
    {
      ...f.ports,
      credentials: {
        async read() {
          throw Error("unexpected central credential access");
        },
        async write() {
          throw Error("unexpected");
        },
        async remove() {
          throw Error("unexpected");
        },
      },
      prepareExecutor: async () => ({
        descriptor,
        async review(input) {
          assert(!input.prompt.includes("CD_CENTRAL_POLICY"));
          return response(input);
        },
      }),
    },
  );
  assert.equal(
    (await job.run(signal())).report.gcr!.report.status,
    "completed",
  );
  assert.equal(f.central.calls, before);
});

test("explicit offline review survives service unavailability but confirmed revocation prevents any model", async (t) => {
  const f = await setup(t);
  let calls = 0;
  const ports = {
    ...f.ports,
    prepareExecutor: async () => ({
      descriptor,
      async review(input: Parameters<LocalReviewExecutor["review"]>[0]) {
        calls++;
        return response(input);
      },
    }),
  };
  f.central.setStatus(503);
  await assert.rejects(
    withCentralConnection(
      f.scope,
      (c) => c.synchronize(f.selection.connectionId),
      f.ports,
    ),
  );
  const before = f.central.calls;
  const job = await prepareStandaloneReview(
    f.request,
    { ...f.settings, freshness: "offline" },
    signal(),
    ports,
  );
  assert.equal(
    (await job.run(signal())).report.gcr!.report.status,
    "completed",
  );
  assert.equal(f.central.calls, before);
  assert.equal(calls, 1);
  f.central.setStatus(403);
  await assert.rejects(
    withCentralConnection(
      f.scope,
      (c) => c.synchronize(f.selection.connectionId),
      f.ports,
    ),
  );
  await assert.rejects(
    prepareStandaloneReview(
      f.request,
      { ...f.settings, freshness: "offline" },
      signal(),
      ports,
    ),
    { code: "authentication-required" },
  );
  assert.equal(calls, 1);
  assert.equal(f.central.credentialValues.size, 0);
});

test("disconnect cancels an in-flight CD review and rejects late source reads", async (t) => {
  const f = await setup(t);
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const held = new Promise<void>((r) => {
    release = r;
  });
  let request: Parameters<LocalReviewExecutor["review"]>[0] | undefined;
  const job = await prepareStandaloneReview(f.request, f.settings, signal(), {
    ...f.ports,
    prepareExecutor: async () => ({
      descriptor,
      async review(input) {
        request = input;
        started();
        await held;
        return response(input);
      },
    }),
  });
  const running = job.run(signal());
  await ready;
  try {
    await withCentralConnection(
      f.scope,
      (c) => c.disconnect(f.selection.connectionId),
      f.ports,
    );
    const report = (await running).report.gcr!.report;
    assert.equal(report.status, "cancelled");
    assert(request?.signal?.aborted);
    await assert.rejects(
      request!.source.execute("read_file", { path: "sum.ts", side: "source" }),
    );
    await assert.rejects(readCentralHistory(f.location, f.selection, f.ports));
  } finally {
    release();
  }
});

test("a foreign profile or a CLI-only key cannot prepare a connected CD executor", async (t) => {
  const f = await setup(t);
  let calls = 0;
  const ports = {
    ...f.ports,
    prepareExecutor: async () => {
      calls++;
      return { descriptor, review: response };
    },
  };
  await assert.rejects(
    prepareStandaloneReview(
      f.request,
      { ...f.settings, profileId: "other" },
      signal(),
      ports,
    ),
  );
  await withCentralConnection(
    f.scope,
    (c) => c.disconnect(f.selection.connectionId),
    f.ports,
  );
  f.central.setClientId("gcr-cli");
  await withCentralConnection(
    f.scope,
    (c) => c.connect(f.central.config, f.central.secret, "gcr-cli"),
    f.ports,
  );
  await assert.rejects(
    prepareStandaloneReview(f.request, f.settings, signal(), ports),
    { code: "authentication-required" },
  );
  assert.equal(calls, 0);
});

// Exercise the scheduler with the shipped manager, credential port, HTTPS
// transport and encrypted cache, without substituting a model executor.
test("background startup refreshes the bound HTTPS publisher and stops in standalone", async (t) => {
  const { central, scope, ports, selection } = await setup(t);
  let ready!: () => void;
  const completed = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const host = new CentralSynchronization({
    ports,
    onState: (_key, state) => {
      if (state.phase === "ready") ready();
    },
  });
  t.after(async () => {
    host.stop();
    await host.settled();
  });
  const before = central.calls;
  host.reconcile([{ scope, selection }]);
  await Promise.race([
    completed,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(Error("Background sync timed out")),
        5000,
      );
      timer.unref();
    }),
  ]);
  assert(central.calls > before);
  host.reconcile([{ scope, selection: { version: 1, mode: "standalone" } }]);
  await host.settled();
  const after = central.calls;
  host.wake();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(central.calls, after);
});

test("background identity failure blocks offline review without erasing the key and recovers after authenticated sync", async (t) => {
  const f = await setup(t);
  let modelCalls = 0;
  const ports = {
    ...f.ports,
    prepareExecutor: async () => ({
      descriptor,
      review: async (input: Parameters<LocalReviewExecutor["review"]>[0]) => {
        modelCalls++;
        return response(input);
      },
    }),
  };
  const credentialsBefore = [...f.central.credentialValues.entries()];
  f.central.setStatus(503, "IDENTITY_UNAVAILABLE");
  let observed!: () => void;
  let rejectObservation!: (error: Error) => void;
  const failed = new Promise<void>((resolve, reject) => {
    observed = resolve;
    rejectObservation = reject;
  });
  const host = new CentralSynchronization({
    ports,
    onState: (_key, state) => {
      if (state.phase === "waiting" && state.reason === "identity-unavailable")
        observed();
    },
  });
  const timeout = setTimeout(
    () => rejectObservation(Error("Identity failure was not observed")),
    5000,
  );
  try {
    host.reconcile([{ scope: f.scope, selection: f.selection }]);
    await failed;
  } finally {
    clearTimeout(timeout);
    host.stop();
    await host.settled();
  }
  await assert.rejects(
    prepareStandaloneReview(
      f.request,
      { ...f.settings, freshness: "offline" },
      signal(),
      ports,
    ),
    { code: "identity-unavailable" },
  );
  assert.equal(modelCalls, 0);
  assert.deepEqual(
    [...f.central.credentialValues.entries()],
    credentialsBefore,
  );
  f.central.setStatus(200);
  await withCentralConnection(
    f.scope,
    (manager) => manager.synchronize(f.selection.connectionId),
    f.ports,
  );
  const job = await prepareStandaloneReview(
    f.request,
    { ...f.settings, freshness: "offline" },
    signal(),
    ports,
  );
  assert.equal(
    (await job.run(signal())).report.gcr!.report.status,
    "completed",
  );
  assert.equal(modelCalls, 1);
});

test("confirmed fallback uses signed cache during outage or local-only knowledge without changing the selection", async (t) => {
  const f = await setup(t);
  f.central.setStatus(503);
  await assert.rejects(
    withCentralConnection(
      f.scope,
      (manager) => manager.synchronize(f.selection.connectionId),
      f.ports,
    ),
  );
  let modelCalls = 0;
  const cachedPorts = {
    ...f.ports,
    prepareExecutor: async () => ({
      descriptor,
      review: async (input: Parameters<LocalReviewExecutor["review"]>[0]) => {
        modelCalls++;
        assert(input.prompt.includes("CD_CENTRAL_POLICY"));
        return response(input);
      },
    }),
  };
  const cached = await prepareStandaloneReview(
    f.request,
    { ...f.settings, offlineBehavior: "cache-then-standalone" },
    signal(),
    cachedPorts,
  );
  const cachedReport = (await cached.run(signal())).report.gcr!.report;
  assert.equal(
    cachedReport.identity.client.execution?.knowledgeSource,
    "central-cache",
  );
  assert(cachedReport.identity.context.centralSnapshot);
  const settings = { ...f.settings, offlineBehavior: "standalone" as const };
  const localPorts = {
    ...f.ports,
    prepareExecutor: async () => ({
      descriptor,
      review: async (input: Parameters<LocalReviewExecutor["review"]>[0]) => {
        modelCalls++;
        assert(!input.prompt.includes("CD_CENTRAL_POLICY"));
        return response(input);
      },
    }),
  };
  const fallback = await prepareStandaloneReview(
    f.request,
    settings,
    signal(),
    localPorts,
  );
  assert.equal(fallback.backendId, "standalone");
  assert.notEqual(fallback.key, cached.key);
  const report = (await fallback.run(signal())).report.gcr!.report;
  assert.equal(report.identity.client.mode, "standalone");
  assert.equal(report.identity.client.execution?.configuredMode, "centralized");
  assert.equal(report.identity.client.execution?.fallbackReason, "unavailable");
  assert.equal(report.identity.context.centralSnapshot, undefined);
  assert(
    report.identity.context.entries.every(
      (entry) => entry.origin !== "central",
    ),
  );
  assert.equal(settings.mode, "centralized");
  assert.equal(modelCalls, 2);
  const selectedHistory = await readSelectedHistory(
    f.location,
    f.selection,
    f.ports,
  );
  assert(selectedHistory.reports.some((r) => r.runId === report.runId));
  const merged = mergeLocalHistory(
    [],
    selectedHistory.reports,
    f.repo,
    f.scope,
    selectedHistory.audience,
    selectedHistory.fallbackConnectionId,
  );
  assert.equal(merged.length, 2);
  assert(merged.some((r) => r.label.includes("Standalone · fallback")));
  assert.equal(
    (
      await readSelectedHistory(
        f.location,
        { ...f.selection, connectionId: "d".repeat(64) },
        f.ports,
      )
    ).reports.length,
    0,
  );
});

test("identity failure permits only confirmed local fallback and never switches model providers", async (t) => {
  const f = await setup(t);
  f.central.setStatus(503, "IDENTITY_UNAVAILABLE");
  let attempts = 0;
  const ports = {
    ...f.ports,
    prepareExecutor: async () => {
      attempts++;
      throw Error("Account executor unavailable");
    },
  };
  await assert.rejects(
    withCentralConnection(
      f.scope,
      (manager) => manager.synchronize(f.selection.connectionId),
      f.ports,
    ),
  );
  await assert.rejects(
    prepareStandaloneReview(
      f.request,
      { ...f.settings, offlineBehavior: "cache-only" },
      signal(),
      ports,
    ),
    { code: "identity-unavailable" },
  );
  assert.equal(attempts, 0);
  await assert.rejects(
    prepareStandaloneReview(
      f.request,
      { ...f.settings, offlineBehavior: "cache-then-standalone" },
      signal(),
      ports,
    ),
    { code: "executor-unavailable" },
  );
  assert.equal(attempts, 1);
});

test("connected review conversations survive unchanged synchronization and reject confirmed revoked resumes", async (t) => {
  const f = await setup(t);
  let calls = 0;
  const executor: import("@gcr/client-core").LocalReviewChatExecutor = {
    descriptor,
    conversationCapability: "checkpoint-tool-v1",
    review: response,
    async converse(input) {
      calls++;
      await input.source.execute("read_file", {
        path: "sum.ts",
        side: "source",
      });
      await input.questions.askUser("central-question", {
        question: "Is subtraction intentional?",
        options: ["Yes", "No"],
      });
      throw Error("paused");
    },
  };
  const ports = { ...f.ports, prepareExecutor: async () => executor };
  const prepared = await prepareStandaloneReview(
    f.request,
    f.settings,
    signal(),
    ports,
  );
  const report = (await prepared.run(signal())).report.gcr!.report;
  const { reviewChatOperation } = await import("../src/reviewChatSession.js");
  const target = {
    repoRoot: f.repo,
    reportId: report.runId,
    mode: "centralized" as const,
  };
  await withCentralConnection(
    f.scope,
    (c) => c.synchronize(f.selection.connectionId),
    f.ports,
  );
  const read = await reviewChatOperation(
    target,
    { type: "read" },
    f.settings,
    signal(),
    undefined,
    ports,
  );
  assert.equal(read.type, "state");
  const pending = await reviewChatOperation(
    target,
    { type: "send", turnId: "central-turn", content: "Explain the change." },
    f.settings,
    signal(),
    undefined,
    ports,
  );
  assert.equal(pending.type, "state");
  if (pending.type !== "state") throw Error("fixture");
  assert.equal(pending.state.conversation.turns[0].status, "awaiting_input");
  assert.equal(calls, 1);
  f.central.setStatus(403);
  await assert.rejects(
    withCentralConnection(
      f.scope,
      (c) => c.synchronize(f.selection.connectionId),
      f.ports,
    ),
  );
  await assert.rejects(
    reviewChatOperation(
      target,
      {
        type: "answer",
        turnId: "central-turn",
        questionId: pending.state.conversation.turns[0].questions[0].id,
        content: "No",
      },
      f.settings,
      signal(),
      undefined,
      ports,
    ),
  );
  assert.equal(calls, 1);
});

test("feedback re-review stops before preparing a model when its confirmed central snapshot changes", async (t) => {
  const f = await setup(t);
  let prepared = 0;
  const ports = {
    ...f.ports,
    prepareExecutor: async () => {
      prepared++;
      return { descriptor, review: response };
    },
  };
  const pinned = {
    ...f.settings,
    offlineBehavior: "pause" as const,
    requiredCentralSnapshot: "snapshot",
  };
  await assert.rejects(
    prepareStandaloneReview(
      f.request,
      { ...pinned, requiredCentralSnapshot: "other" },
      signal(),
      ports,
    ),
    { code: "central-snapshot-changed" },
  );
  await assert.rejects(
    prepareStandaloneReview(
      f.request,
      { ...pinned, mode: "standalone" },
      signal(),
      ports,
    ),
    { code: "central-snapshot-changed" },
  );
  await assert.rejects(
    prepareStandaloneReview(
      f.request,
      { ...pinned, offlineBehavior: "standalone" },
      signal(),
      ports,
    ),
    { code: "central-snapshot-changed" },
  );
  assert.equal(prepared, 0);
  const job = await prepareStandaloneReview(f.request, pinned, signal(), ports);
  assert.equal(
    (await job.run(signal())).report.gcr!.report.status,
    "completed",
  );
  assert.equal(prepared, 1);
  f.central.publishCriteria([]);
  await withCentralConnection(
    f.scope,
    (c) => c.synchronize(f.selection.connectionId),
    f.ports,
  );
  await assert.rejects(
    prepareStandaloneReview(f.request, pinned, signal(), ports),
    { code: "central-snapshot-changed" },
  );
  assert.equal(prepared, 1);
});
