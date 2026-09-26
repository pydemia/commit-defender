import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import path from "node:path";
import type { ExtensionContext } from "vscode";
import { contentHash, type LocalReviewExecutor } from "@gcr/client-core";
import { manageCentralConnection } from "../src/centralConnectionView.js";
import {
  readSelection,
  selectedReviewSettings,
  withCentralConnection,
  centralSelection,
  type CentralSelection,
} from "../src/centralConnection.js";
import { knowledgeScope } from "../src/localKnowledge.js";
import { prepareStandaloneReview } from "../src/standaloneReview.js";
import { centralFixture } from "./helpers/central-fixture.js";
import { fixture } from "./helpers/review-fixture.js";
import { ui } from "./helpers/vscode-central.js";

const descriptor: LocalReviewExecutor["descriptor"] = {
  id: "fixture",
  version: "1",
  model: "synthetic",
  configHash: contentHash("multi-source"),
  capabilities: {
    available: true,
    sourceIsolation: "fixed-source-only",
    cancellation: true,
    timeout: true,
    childProcessCleanup: true,
    outputTokenLimit: false,
  },
};
const defaults = {
  mode: "standalone",
  profileId: "source-test",
  provider: "codex",
  model: "synthetic",
  reasoningEffort: "high",
  executablePath: "/unused",
  workspaceTrusted: true,
  durationMs: 30000,
  excludePatterns: [],
};
const signal = () => new AbortController().signal;

async function setup(t: TestContext) {
  ui.reset();
  const f = fixture();
  f.write("sum.ts", "export const sum = (a:number,b:number)=>a+b;\n");
  f.git("add", ".");
  f.git("commit", "-m", "base");
  f.write("sum.ts", "export const sum = (a:number,b:number)=>a-b;\n");
  f.git("add", "sum.ts");
  f.git("remote", "add", "origin", "https://github.example/team/reviewer.git");
  const server = await centralFixture(
    f.root,
    "PRIMARY_SOURCE_SKILL",
    true,
    undefined,
    [
      {
        repositoryId: "helm-source",
        name: "helm",
        instructions: "REFERENCE_SOURCE_SKILL",
      },
    ],
  );
  t.after(async () => {
    ui.reset();
    await server.close();
    f.cleanup();
  });
  const scope = knowledgeScope({
    profileId: defaults.profileId,
    repoRoot: f.repo,
    scope: "repository",
  });
  if (scope.kind !== "repository") throw Error("scope");
  const ports = {
    dataDirectory: path.join(f.root, "data"),
    keys: server.keys,
    credentials: server.credentials,
  };
  const state = new Map<string, unknown>();
  const context = {
    subscriptions: [],
    globalState: {
      get<T>(key: string) {
        return state.get(key) as T | undefined;
      },
      async update(key: string, value: unknown) {
        state.set(key, value);
      },
    },
  } as unknown as ExtensionContext;
  const actions = {
    repositoryRoot: f.repo,
    assertCurrent() {},
    async invalidate() {},
    async refresh() {},
  };
  const cert = path.join(f.root, "ca.pem");
  fs.writeFileSync(cert, server.config.ca!);
  ui.file = cert;
  ui.inputValues = [server.config.serverUrl, server.secret];
  ui.choices = ["connect"];
  await manageCentralConnection(context, scope, actions, ports);
  assert.deepEqual(ui.errors, [], JSON.stringify(server.requestMetadata));
  const selection = readSelection(context.globalState, scope);
  assert(selection?.mode === "centralized" && selection.sources?.length === 2);
  return { ...f, server, scope, ports, state, context, actions, selection };
}

test("URL and key connect all sources without repository choices; content preview and optional range preserve credentials", async (t) => {
  const f = await setup(t);
  assert.equal(
    ui.quickPicks.length,
    1,
    "the only picker is the connection action menu",
  );
  assert.equal(f.selection.sources![0].referenceOnly, false);
  assert.equal(f.selection.sources![1].referenceOnly, true);
  assert(!JSON.stringify([...f.state]).includes(f.server.secret));
  ui.choices = ["knowledge"];
  await manageCentralConnection(f.context, f.scope, f.actions, f.ports);
  assert.deepEqual(ui.errors, []);
  assert(
    ui.html.at(-1)?.includes("team/reviewer") &&
      ui.html.at(-1)?.includes("team/helm"),
  );
  assert(ui.html.at(-1)?.includes("REFERENCE_SOURCE_SKILL"));
  ui.choices = ["sources", [0]];
  await manageCentralConnection(f.context, f.scope, f.actions, f.ports);
  assert.equal(
    (
      readSelection(f.context.globalState, f.scope) as Extract<
        CentralSelection,
        { mode: "centralized" }
      >
    ).sources?.length,
    1,
  );
  assert.equal(
    f.server.credentialValues.size,
    2,
    "limiting references never deletes the key or cache",
  );
  ui.choices = ["sources", [0, 1]];
  await manageCentralConnection(f.context, f.scope, f.actions, f.ports);
  assert.equal(
    (
      readSelection(f.context.globalState, f.scope) as Extract<
        CentralSelection,
        { mode: "centralized" }
      >
    ).sources?.length,
    2,
  );
  ui.choices = ["standalone"];
  await manageCentralConnection(f.context, f.scope, f.actions, f.ports);
  ui.choices = ["select"];
  await manageCentralConnection(f.context, f.scope, f.actions, f.ports);
  assert.equal(
    (
      readSelection(f.context.globalState, f.scope) as Extract<
        CentralSelection,
        { mode: "centralized" }
      >
    ).sources?.length,
    2,
  );
  assert(
    f.server.requestMetadata.every(
      (r) => r.method === "GET" && r.bodyBytes === 0,
    ),
  );
});

test("two sources reach the local executor, keep separate pinned versions, and do not import foreign mandatory policy", async (t) => {
  const f = await setup(t);
  let observed = false;
  const prepared = await prepareStandaloneReview(
    { repoRoot: f.repo, files: ["sum.ts"], scope: "staged" },
    selectedReviewSettings(defaults, f.selection),
    signal(),
    {
      ...f.ports,
      prepareExecutor: async () => ({
        descriptor,
        async review(input) {
          assert(input.prompt.includes("PRIMARY_SOURCE_SKILL"));
          assert(input.prompt.includes("REFERENCE_SOURCE_SKILL"));
          const data = JSON.parse(
            input.prompt.slice(input.prompt.lastIndexOf("\n\n") + 2),
          );
          const foreign = data.centralKnowledge.filter(
            (item: any) => item.source?.audience.repositoryId === "helm-source",
          );
          assert(
            foreign.length > 0 &&
              foreign.every(
                (item: any) => item.role === "supplement" && !item.required,
              ),
          );
          assert(!foreign.some((item: any) => item.kind === "policy"));
          const readIds = [];
          for (const side of ["source", "base"])
            readIds.push(
              JSON.parse(
                await input.source.execute("read_file", {
                  path: "sum.ts",
                  side,
                }),
              ).readId,
            );
          observed = true;
          return {
            model: "synthetic",
            raw: JSON.stringify({
              summary: "Inspected both reference sources against fixed source",
              files: [
                {
                  path: "sum.ts",
                  side: "source",
                  complete: true,
                  summary: "Inspected",
                  readIds,
                },
              ],
              findings: [],
              questions: [],
            }),
          };
        },
      }),
    },
  );
  try {
    const result = await prepared.run(signal());
    assert(observed);
    assert.equal(result.report.gcr!.report.status, "completed");
    assert.equal(
      result.report.gcr!.report.identity.context.centralSources?.length,
      2,
    );
    assert(
      result.report.gcr!.report.identity.context.entries.some(
        (e) =>
          e.origin === "central" && e.audience?.repositoryId === "helm-source",
      ),
    );
  } finally {
    prepared.dispose();
  }
  assert.equal(f.server.submissionCalls, 0);
  assert(
    f.server.requestMetadata.every(
      (r) => r.method === "GET" && r.bodyBytes === 0,
    ),
  );
});

test("revocation of an additional source prevents a prepared local review from succeeding", async (t) => {
  const f = await setup(t);
  const prepared = await prepareStandaloneReview(
    { repoRoot: f.repo, files: ["sum.ts"], scope: "staged" },
    selectedReviewSettings(
      { ...defaults, offlineBehavior: "pause" },
      f.selection,
    ),
    signal(),
    {
      ...f.ports,
      prepareExecutor: async () => ({
        descriptor,
        async review() {
          throw Error("revoked context must not call a model");
        },
      }),
    },
  );
  f.server.setRepositoryStatus("helm-source", 403);
  await assert.rejects(
    withCentralConnection(
      f.scope,
      (m) => m.synchronize(f.selection.sources![1].connectionId),
      { ...f.ports, repositoryRoot: f.repo },
    ),
  );
  try {
    await assert.rejects(
      prepared.run(signal()),
      (error: any) => error.code === "authentication-required",
    );
  } finally {
    prepared.dispose();
  }
});

test("source selections reject duplicate, unknown or inconsistent connections", () => {
  const source = {
    connectionId: "a".repeat(64),
    repositoryId: "repo",
    label: "Readable source",
    referenceOnly: true,
  };
  const value = {
    version: 1,
    mode: "centralized",
    connectionId: source.connectionId,
    freshness: "online",
    sources: [source],
  };
  assert.throws(() =>
    centralSelection({ ...value, sources: [source, source] }),
  );
  assert.throws(() =>
    centralSelection({ ...value, connectionId: "b".repeat(64) }),
  );
  assert.throws(() =>
    centralSelection({
      ...value,
      sources: [{ ...source, secret: "must not persist" }],
    }),
  );
});
