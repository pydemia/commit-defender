import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import path from "node:path";
import { contentHash, type LocalReviewExecutor } from "@gcr/client-core";
import { prepareStandaloneReview } from "../src/standaloneReview.js";
import {
  centralSelection,
  readCentralHistory,
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
async function setup(t: TestContext) {
  const f = fixture();
  f.write("sum.ts", "export const sum = (a: number, b: number) => a + b;\n");
  f.git("add", ".");
  f.git("commit", "-m", "base");
  f.write("sum.ts", "export const sum = (a: number, b: number) => a - b;\n");
  f.git("add", "sum.ts");
  const central = await centralFixture(f.root);
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

test("connected CD review combines signed central and local knowledge and restores audience-bound history", async (t) => {
  const f = await setup(t);
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
