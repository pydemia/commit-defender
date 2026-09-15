import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers/review-fixture.js";
import { centralFixture } from "./helpers/central-fixture.js";
import { knowledgeScope } from "../src/localKnowledge.js";
import { withCentralConnection } from "../src/centralConnection.js";
import { centralHistoryHtml } from "../src/centralHistoryView.js";

test("history uses bounded GET pages and encrypted scoped cache; revocation prevents offline reuse", async (t) => {
  const f = fixture(),
    repositoryId = randomUUID();
  const requests: string[] = [];
  const response = {
    schemaVersion: 1,
    repositoryId,
    revision: "a".repeat(64),
    items: [],
    nextCursor: null,
    capabilities: { manage: false },
  };
  const central = await centralFixture(f.root, undefined, false, {
    repositoryId,
    respond(url) {
      requests.push(url);
      return response;
    },
  });
  t.after(async () => {
    await central.close();
    f.cleanup();
  });
  const scope = knowledgeScope({
    profileId: "history-test",
    repoRoot: f.repo,
    scope: "repository",
  });
  const ports = {
    dataDirectory: path.join(f.root, "data"),
    keys: central.keys,
    credentials: central.credentials,
  };
  const withManager = <T>(
    work: Parameters<typeof withCentralConnection<T>>[1],
  ) => withCentralConnection(scope, work, ports);
  const connected = await withManager((c) =>
    c.connect(central.config, central.secret, "commit-defender"),
  );
  const online = await withManager((c) =>
    c.readHistory(connected.id, { kind: "pulls", pullNumber: 917 }),
  );
  assert.equal(online.cached, false);
  assert.deepEqual(online.data, response);
  const calls = central.calls;
  const cached = await withManager((c) =>
    c.readHistory(connected.id, { kind: "pulls", pullNumber: 917 }, "offline"),
  );
  assert.equal(cached.cached, true);
  assert.equal(central.calls, calls);
  assert.deepEqual(requests, [
    `/base/api/v1/repositories/${repositoryId}/review-history?pullNumber=917`,
  ]);
  for (const value of [
    { kind: "pulls", localDiff: "never-upload" },
    { kind: "message", sourceId: "../private" },
    { kind: "pulls", sourceId: randomUUID() },
  ])
    await assert.rejects(
      withManager((c) => c.readHistory(connected.id, value)),
    );
  assert.equal(central.calls, calls);
  central.setStatus(403);
  await assert.rejects(
    withManager((c) =>
      c.readHistory(connected.id, { kind: "pulls", pullNumber: 917 }),
    ),
    { code: "revoked" },
  );
  await assert.rejects(
    withManager((c) =>
      c.readHistory(
        connected.id,
        { kind: "pulls", pullNumber: 917 },
        "offline",
      ),
    ),
  );
  assert.equal(central.credentialValues.size, 0);
  assert(central.requestMethods.every((method) => method === "GET"));
});

test("history viewer renders raw comment text without executable HTML", () => {
  const data = {
    schemaVersion: 1,
    repositoryId: randomUUID(),
    revision: "a".repeat(64),
    pullNumber: 917,
    item: {
      body: "<img src=x onerror=alert(1)>",
      authorLogin: "<script>alert(1)</script>",
      htmlUrl: "javascript:alert(1)",
      contentHash: "b".repeat(64),
    },
  };
  const html = centralHistoryHtml("Original", {
    data: data as any,
    cached: false,
    fetchedAt: "now",
    expiresAt: "later",
  });
  assert(!html.includes("<img"));
  assert(!html.includes("<script>"));
  assert(html.includes("&lt;img"));
  assert(!html.includes('href="javascript:'));
  assert(html.includes("default-src 'none'"));
});
