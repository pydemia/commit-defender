import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import type { ExtensionContext } from "vscode";
import {
  manageCentralConnection,
  centralStatusHtml,
} from "../src/centralConnectionView.js";
import { readSelection } from "../src/centralConnection.js";
import { knowledgeScope } from "../src/localKnowledge.js";
import { fixture } from "./helpers/review-fixture.js";
import { centralFixture } from "./helpers/central-fixture.js";
import { ui } from "./helpers/vscode-central.js";

test("connection UI scopes selection, masks the API key, shows signed status and disconnects without fallback", async (t) => {
  ui.reset();
  const f = fixture(),
    server = await centralFixture(f.root);
  t.after(async () => {
    await server.close();
    f.cleanup();
  });
  const scope = knowledgeScope({
    profileId: "cd-ui",
    repoRoot: f.repo,
    scope: "repository",
  });
  if (scope.kind !== "repository") throw Error("scope");
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
  let invalidations = 0,
    refreshes = 0;
  const actions = {
    assertCurrent() {},
    async invalidate() {
      invalidations++;
    },
    async refresh() {
      refreshes++;
    },
  };
  const ports = {
    dataDirectory: path.join(f.root, "data"),
    keys: server.keys,
    credentials: server.credentials,
  };
  const run = async (action: string, pick?: number) => {
    ui.choices = [action, ...(pick === undefined ? [] : [pick])];
    await manageCentralConnection(context, scope, actions, ports);
    assert.deepEqual(ui.errors, []);
  };
  ui.file = path.join(f.root, "connection.json");
  fs.writeFileSync(ui.file, JSON.stringify(server.config));
  ui.secret = server.secret;
  await run("connect");
  const selected = readSelection(context.globalState, scope);
  assert.equal(selected?.mode, "centralized");
  assert(
    selected?.mode === "centralized" &&
      selected.offlineBehavior === "cache-then-standalone",
  );
  assert.equal(ui.inputs[0]?.password, true);
  assert.equal(server.credentialValues.size, 1);
  assert.equal(invalidations, 1);
  assert.equal(refreshes, 1);
  assert(!JSON.stringify([...state]).includes(server.secret));
  await run("status");
  assert(ui.html.at(-1)?.includes("Signed knowledge bundles"));
  assert(ui.html.at(-1)?.includes("Release 1"));
  assert(!ui.html.join("").includes(server.secret));
  assert(!ui.html.join("").includes("BEGIN PUBLIC KEY"));
  await run("sync");
  await run("offline");
  const offline = readSelection(context.globalState, scope);
  assert(offline?.mode === "centralized" && offline.freshness === "offline");
  const before = server.calls;
  await run("standalone");
  assert.equal(server.calls, before);
  assert.equal(readSelection(context.globalState, scope)?.mode, "standalone");
  await run("select", 0);
  await run("fallback", 3);
  const paused = readSelection(context.globalState, scope);
  assert(paused?.mode === "centralized" && paused.offlineBehavior === "pause");
  await run("disconnect");
  assert.equal(readSelection(context.globalState, scope)?.mode, "centralized");
  assert.equal(server.credentialValues.size, 0);
  assert(ui.messages.some((m) => m.includes("offline behavior is pause")));
  assert(!JSON.stringify(ui.messages).includes(server.secret));
});

test("cancelling server confirmation never stores a key or contacts the server", async (t) => {
  ui.reset();
  const f = fixture(),
    server = await centralFixture(f.root);
  t.after(async () => {
    await server.close();
    f.cleanup();
  });
  const scope = knowledgeScope({
    profileId: "cd-ui-cancel",
    repoRoot: f.repo,
    scope: "repository",
  });
  if (scope.kind !== "repository") throw Error("scope");
  const context = {
    subscriptions: [],
    globalState: {
      get() {},
      async update() {
        throw Error("unexpected selection");
      },
    },
  } as unknown as ExtensionContext;
  ui.file = path.join(f.root, "connection.json");
  fs.writeFileSync(ui.file, JSON.stringify(server.config));
  ui.choices = ["connect"];
  ui.cancelConnect = true;
  await manageCentralConnection(
    context,
    scope,
    { assertCurrent() {}, async invalidate() {}, async refresh() {} },
    {
      dataDirectory: path.join(f.root, "data"),
      keys: server.keys,
      credentials: server.credentials,
    },
  );
  assert.equal(server.calls, 0);
  assert.equal(ui.inputs.length, 0);
  assert.equal(server.credentialValues.size, 0);
  assert.deepEqual(ui.errors, []);
});

test("read-only status escapes server metadata and omits unexpected secret fields", () => {
  const html = centralStatusHtml({
    serverUrl: '<script>alert("x")</script>',
    audience: { userId: '<img onerror="alert(1)">' },
    cache: { status: "unavailable" },
    apiKey: "DO_NOT_RENDER",
  });
  assert(!html.includes("<script>"));
  assert(!html.includes("<img"));
  assert(html.includes("&lt;script&gt;"));
  assert(!html.includes("DO_NOT_RENDER"));
  assert(html.includes("default-src 'none'"));
});

test("confirmed first-publication failure retains local fallback selection without its key", async (t) => {
  ui.reset();
  const f = fixture(),
    server = await centralFixture(f.root);
  t.after(async () => {
    await server.close();
    f.cleanup();
  });
  const scope = knowledgeScope({
    profileId: "initial-fallback",
    repoRoot: f.repo,
    scope: "repository",
  });
  if (scope.kind !== "repository") throw Error("scope");
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
  ui.file = path.join(f.root, "config.json");
  fs.writeFileSync(ui.file, JSON.stringify(server.config));
  ui.secret = server.secret;
  ui.choices = ["connect"];
  server.failFirstManifest();
  await manageCentralConnection(
    context,
    scope,
    { assertCurrent() {}, async invalidate() {}, async refresh() {} },
    {
      dataDirectory: path.join(f.root, "data"),
      keys: server.keys,
      credentials: server.credentials,
    },
  );
  const selection = readSelection(context.globalState, scope);
  assert(
    selection?.mode === "centralized" &&
      selection.offlineBehavior === "cache-then-standalone",
  );
  assert.equal(server.credentialValues.size, 0);
  assert.equal(ui.errors.length, 0);
  assert(
    ui.messages.some((m) => m.includes("confirmed local fallback policy")),
  );
});
