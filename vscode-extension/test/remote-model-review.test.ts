import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import path from "node:path";
import fs from "node:fs";
import { CentralConnections, RemoteReviewClient } from "@gcr/client-core";
import {
  prepareRemoteModelReview,
  type RemoteProposal,
} from "../src/remoteModelReview.js";
import { knowledgeScope } from "../src/localKnowledge.js";
import { fixture } from "./helpers/review-fixture.js";
import { centralFixture } from "./helpers/central-fixture.js";
import type { StandaloneReviewSettings } from "../src/standaloneReviewProtocol.js";

async function setup(t: TestContext, central = false) {
  const f = fixture();
  t.after(() => f.cleanup());
  f.write("sum.ts", "export const value = 1;\n");
  f.git("add", ".");
  f.git("commit", "-m", "base");
  f.write("sum.ts", "export const value = 2;\n");
  f.git("add", ".");
  const server = await centralFixture(f.root);
  server.remote.enabled = true;
  t.after(() => server.close());
  const ports = {
    keys: server.keys,
    credentials: server.credentials,
    dataDirectory: path.join(f.root, "data"),
  };
  const scope = knowledgeScope({
    repoRoot: f.repo,
    profileId: "remote-test",
    scope: "repository",
  });
  const manager = await CentralConnections.open({ scope, ...ports });
  t.after(() => manager.close());
  const connection = await manager.connect(
    server.config,
    server.secret,
    "commit-defender",
  );
  const settings: StandaloneReviewSettings = {
    mode: central ? "centralized" : "standalone",
    ...(central
      ? { connectionId: connection.id, freshness: "online" as const }
      : {}),
    profileId: "remote-test",
    provider: "unconfigured",
    model: "",
    reasoningEffort: "",
    executablePath: f.executable,
    workspaceTrusted: true,
    durationMs: 30000,
    excludePatterns: [],
  };
  const choice = {
    connectionId: connection.id,
    accountId: "fixture-account",
    name: "gpt-6-astra",
    reasoningEffort: "high" as const,
  };
  const request = {
    repoRoot: f.repo,
    files: ["sum.ts"],
    scope: "staged" as const,
  };
  const openRemote = async () => {
    const c = await RemoteReviewClient.open({
      scope,
      ...ports,
      connectionId: connection.id,
      connections: manager,
    });
    t.after(() => c.close());
    return c;
  };
  return {
    f,
    server,
    ports,
    scope,
    manager,
    connection,
    settings,
    choice,
    request,
    openRemote,
  };
}
test("preview requires approval and never starts a local provider or uploads source on dismissal", async (t) => {
  const f = await setup(t);
  let shown = false;
  await assert.rejects(
    prepareRemoteModelReview(
      f.request,
      f.settings,
      f.choice,
      new AbortController().signal,
      {
        assertCurrent() {},
        async confirm(proposal) {
          shown = true;
          assert.equal(proposal.payload.source.files.length, 2);
          return undefined;
        },
      },
      f.ports,
    ),
    /upload-not-approved/,
  );
  assert.equal(shown, true);
  assert.equal(f.server.remote.posts, 0);
  assert.equal(fs.existsSync(f.f.capture), false);
});
test("executes only the approved frozen source and renders a verified central result without local account configuration", async (t) => {
  const f = await setup(t);
  let preview: RemoteProposal | undefined;
  const prepared = await prepareRemoteModelReview(
    f.request,
    f.settings,
    f.choice,
    new AbortController().signal,
    {
      assertCurrent() {},
      async confirm(p) {
        preview = p;
        return p.payloadHash;
      },
    },
    f.ports,
  );
  t.after(() => prepared.dispose?.());
  assert.equal(f.server.remote.posts, 0);
  f.f.write("sum.ts", "export const value = 999;\n");
  f.f.git("add", ".");
  const result = await prepared.run(new AbortController().signal);
  assert.equal(result.report.gcr?.report.identity.executor.id, "central");
  assert.equal(result.report.gcr?.report.identity.client.mode, "standalone");
  assert.equal(result.capturedSources?.["sum.ts"], "export const value = 2;\n");
  assert.deepEqual(f.server.remote.input?.payload, preview!.payload);
  assert.equal(f.server.remote.posts, 1);
  assert.equal(fs.existsSync(f.f.capture), false);
});
test("preserves explicitly selected central knowledge and refuses another execution server", async (t) => {
  const f = await setup(t, true);
  await assert.rejects(
    prepareRemoteModelReview(
      f.request,
      f.settings,
      { ...f.choice, connectionId: "0".repeat(64) },
      new AbortController().signal,
      { assertCurrent() {}, confirm: async (p) => p.payloadHash },
      f.ports,
    ),
    /knowledge-connection-mismatch/,
  );
  const prepared = await prepareRemoteModelReview(
    f.request,
    f.settings,
    f.choice,
    new AbortController().signal,
    {
      assertCurrent() {},
      async confirm(p) {
        assert.ok(p.payload.context.resolved?.central);
        return p.payloadHash;
      },
    },
    f.ports,
  );
  t.after(() => prepared.dispose?.());
  const result = await prepared.run(new AbortController().signal);
  assert.equal(result.report.gcr?.report.identity.client.mode, "centralized");
  assert.equal(f.server.remote.posts, 1);
  assert.equal(fs.existsSync(f.f.capture), false);
});
test("stops before upload when the profile or connection selection changes during approval", async (t) => {
  const f = await setup(t);
  let active = true;
  await assert.rejects(
    prepareRemoteModelReview(
      f.request,
      f.settings,
      f.choice,
      new AbortController().signal,
      {
        assertCurrent() {
          if (!active) throw Error("selection-changed");
        },
        async confirm(p) {
          active = false;
          return p.payloadHash;
        },
      },
      f.ports,
    ),
    /selection-changed/,
  );
  assert.equal(f.server.remote.posts, 0);
});
test("records an unacknowledged request for recovery and never falls back or repeats POST", async (t) => {
  const f = await setup(t);
  f.server.remote.dropAck = true;
  let id = "";
  const prepared = await prepareRemoteModelReview(
    f.request,
    f.settings,
    f.choice,
    new AbortController().signal,
    {
      assertCurrent() {},
      async confirm(p) {
        id = p.payload.requestId;
        return p.payloadHash;
      },
    },
    f.ports,
  );
  t.after(() => prepared.dispose?.());
  await assert.rejects(
    prepared.run(new AbortController().signal),
    /outcome-unconfirmed/,
  );
  const remote = await f.openRemote();
  assert.equal((await remote.refresh(id)).status?.state, "completed");
  assert.equal(
    (await remote.result(id)).report.identity.executor.id,
    "central",
  );
  assert.equal(f.server.remote.posts, 1);
  assert.equal(fs.existsSync(f.f.capture), false);
});
test("local cancellation requests server cancellation with a separate bounded credential operation", async (t) => {
  const f = await setup(t);
  f.server.remote.pending = true;
  const prepared = await prepareRemoteModelReview(
    f.request,
    f.settings,
    f.choice,
    new AbortController().signal,
    { assertCurrent() {}, confirm: async (p) => p.payloadHash },
    f.ports,
  );
  t.after(() => prepared.dispose?.());
  const stop = new AbortController();
  const pending = prepared.run(stop.signal, (_current, _total, label) => {
    if (label.startsWith("Central request")) stop.abort("user");
  });
  await assert.rejects(pending, /cancelled/);
  assert.equal(f.server.remote.cancels, 1);
  assert.equal(f.server.remote.receipt?.state, "cancelled");
  assert.equal(f.server.remote.posts, 1);
});
test("automatic requests and untrusted workspaces cannot select the remote path", async (t) => {
  const f = await setup(t);
  await assert.rejects(
    prepareRemoteModelReview(
      f.request,
      { ...f.settings, workspaceTrusted: false },
      f.choice,
      new AbortController().signal,
      { assertCurrent() {}, confirm: async (p) => p.payloadHash },
      f.ports,
    ),
    /manual-trusted-review-required/,
  );
  await assert.rejects(
    prepareRemoteModelReview(
      {
        ...f.request,
        automatic: {
          reason: "stage",
          head: null,
          indexFingerprint: "x",
          minimumIntervalMs: 0,
          maximumReviewsPerHour: 1,
        },
      },
      f.settings,
      f.choice,
      new AbortController().signal,
      { assertCurrent() {}, confirm: async (p) => p.payloadHash },
      f.ports,
    ),
    /manual-trusted-review-required/,
  );
  assert.equal(f.server.remote.posts, 0);
});

test("feedback re-review refuses a changed central snapshot before approval or model execution", async (t) => {
  const f = await setup(t, true);
  let approvals = 0;
  await assert.rejects(
    prepareRemoteModelReview(
      f.request,
      { ...f.settings, requiredCentralSnapshot: "0".repeat(64) },
      f.choice,
      new AbortController().signal,
      {
        assertCurrent() {},
        async confirm(p) {
          approvals++;
          return p.payloadHash;
        },
      },
      f.ports,
    ),
    /central-snapshot-changed/,
  );
  assert.equal(approvals, 0);
  assert.equal(f.server.remote.posts, 0);
  assert.equal(fs.existsSync(f.f.capture), false);
});
