import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import type { ExtensionContext } from "vscode";
import {
  manageCentralConnection,
  centralStatusHtml,
} from "../src/centralConnectionView.js";
import {
  readSelection,
  selectionKey,
  withCentralConnection,
} from "../src/centralConnection.js";
import { knowledgeScope } from "../src/localKnowledge.js";
import { fixture } from "./helpers/review-fixture.js";
import { centralFixture } from "./helpers/central-fixture.js";
import { ui } from "./helpers/vscode-central.js";
import { showCentralKnowledge } from "../src/centralKnowledgeView.js";

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
  await run("import-json");
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
  const beforeKnowledge = server.calls;
  await run("knowledge");
  assert(ui.html.at(-1)?.includes("CD_CENTRAL_POLICY"));
  assert(
    ui.html.at(-1)?.includes("Reviews run with your locally configured model"),
  );
  assert(ui.html.at(-1)?.includes("No published review criteria"));
  assert(!ui.html.at(-1)?.includes(server.secret));
  assert.equal(
    server.calls,
    beforeKnowledge,
    "fresh downloaded knowledge does not request a model or network",
  );
  assert.equal(server.submissionCalls, 0);
  const knowledgePanel = ui.panels.at(-1)!;
  await run("status");
  assert.equal(knowledgePanel.disposed, true);
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

test("downloaded prompt text stays inert and an open view closes when local access is revoked", async (t) => {
  ui.reset();
  const f = fixture();
  const server = await centralFixture(
    f.root,
    '<script>PRIVATE_PROMPT()</script><img src="https://untrusted.invalid/pixel">',
  );
  t.after(async () => {
    ui.reset();
    await server.close();
    f.cleanup();
  });
  const scope = knowledgeScope({
    profileId: "knowledge-revocation",
    repoRoot: f.repo,
    scope: "repository",
  });
  if (scope.kind !== "repository") throw Error("scope");
  const ports = {
    dataDirectory: path.join(f.root, "data"),
    keys: server.keys,
    credentials: server.credentials,
  };
  const connected = await withCentralConnection(
    scope,
    (m) => m.connect(server.config, server.secret, "commit-defender"),
    ports,
  );
  const values = new Map<string, unknown>([
    [
      selectionKey(scope),
      {
        version: 1,
        mode: "centralized",
        connectionId: connected.id,
        freshness: "online",
      },
    ],
  ]);
  const context = {
    subscriptions: [],
    globalState: {
      get<T>(key: string) {
        return values.get(key) as T | undefined;
      },
      async update(key: string, value: unknown) {
        values.set(key, value);
      },
    },
  } as unknown as ExtensionContext;
  const actions = {
    assertCurrent() {},
    async invalidate() {},
    async refresh() {},
  };
  ui.choices = ["knowledge"];
  await manageCentralConnection(context, scope, actions, ports);
  assert.deepEqual(ui.errors, []);
  const html = ui.html.at(-1)!;
  assert(html.includes("&lt;script&gt;PRIVATE_PROMPT"));
  assert(!html.includes("<script>"));
  assert(!html.includes("<img"));
  assert(!html.includes("<a "));
  assert(html.includes("form-action 'none'"));
  let panel = ui.panels.at(-1)!;
  const originalSelection = values.get(selectionKey(scope));
  values.set(selectionKey(scope), { version: 1, mode: "standalone" });
  panel.focus();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    panel.disposed,
    true,
    "changing the selected scope removes the old content",
  );
  values.set(selectionKey(scope), originalSelection);
  ui.choices = ["knowledge"];
  await manageCentralConnection(context, scope, actions, ports);
  panel = ui.panels.at(-1)!;
  assert.equal(panel.disposed, false);
  const snapshot = await withCentralConnection(
    scope,
    async (m) => {
      const ready = await m.review(connected.id, "offline");
      return ready.cache.read("offline");
    },
    ports,
  );
  // Drive the panel's local lease timer independently of network or model access.
  const expiring = structuredClone(snapshot);
  expiring.manifest.payload.offlineValidUntil = new Date(
    Date.now() + 40,
  ).toISOString();
  showCentralKnowledge(context, expiring, async () => {});
  const leasePanel = ui.panels.at(-1)!;
  for (let attempt = 0; attempt < 100 && !leasePanel.disposed; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    leasePanel.disposed,
    true,
    "expired content is removed without a focus event",
  );
  const before = server.calls;
  await withCentralConnection(scope, (m) => m.disconnect(connected.id), ports);
  panel.focus();
  for (let attempt = 0; attempt < 100 && !panel.disposed; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(panel.disposed, true);
  assert.equal(ui.html.at(-1), "");
  assert.equal(
    server.calls,
    before,
    "access checks use local authorization barriers without uploading or executing models",
  );
  ui.choices = ["knowledge"];
  const panelCount = ui.panels.length;
  await manageCentralConnection(context, scope, actions, ports);
  assert.equal(
    ui.panels.length,
    panelCount,
    "disconnected content must not open again",
  );
  assert.equal(ui.errors.length, 1);
  assert.match(ui.errors[0]!, /^Commit Defender: Central review connection/);
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
  ui.choices = ["import-json"];
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

test("connection UI binds this Git worktree and blocks downloaded content after a remote change", async (t) => {
  ui.reset();
  const f = fixture(),
    server = await centralFixture(f.root);
  t.after(async () => {
    ui.reset();
    await server.close();
    f.cleanup();
  });
  const scope = knowledgeScope({
    profileId: "remote-ui",
    repoRoot: f.repo,
    scope: "repository",
  });
  if (scope.kind !== "repository") throw Error("scope");
  const values = new Map<string, unknown>();
  const context = {
    subscriptions: [],
    globalState: {
      get<T>(key: string) {
        return values.get(key) as T | undefined;
      },
      async update(key: string, value: unknown) {
        values.set(key, value);
      },
    },
  } as unknown as ExtensionContext;
  const actions = {
    repositoryRoot: f.repo,
    assertCurrent() {},
    async invalidate() {},
    async refresh() {},
  };
  const ports = {
    dataDirectory: path.join(f.root, "data"),
    keys: server.keys,
    credentials: server.credentials,
  };
  ui.file = path.join(f.root, "connection.json");
  fs.writeFileSync(ui.file, JSON.stringify(server.config));
  ui.secret = server.secret;
  f.git(
    "remote",
    "add",
    "origin",
    "https://user:PRIVATE_REMOTE@github.example/fork/reviewer.git",
  );
  ui.choices = ["import-json"];
  await manageCentralConnection(context, scope, actions, ports);
  assert.equal(server.credentialValues.size, 0);
  assert.equal(ui.errors.length, 1);
  assert.match(ui.errors[0]!, /^Commit Defender: Central review connection/);
  assert(ui.errors[0]!.includes("Git remotes"));
  assert(!ui.errors[0]!.includes("PRIVATE_REMOTE"));
  ui.errors = [];
  f.git("remote", "set-url", "origin", "git@github.example:team/reviewer.git");
  ui.choices = ["import-json"];
  await manageCentralConnection(context, scope, actions, ports);
  assert.deepEqual(ui.errors, []);
  ui.choices = ["status"];
  await manageCentralConnection(context, scope, actions, ports);
  assert(
    ui.html.at(-1)?.includes("Verified against central repository identity"),
  );
  f.git("remote", "set-url", "origin", "git@another.example:team/reviewer.git");
  ui.choices = ["knowledge"];
  const panels = ui.panels.length;
  await manageCentralConnection(context, scope, actions, ports);
  assert.equal(ui.panels.length, panels);
  assert(String(ui.errors.at(-1)).includes("Git remotes"));
  ui.choices = ["disconnect"];
  await manageCentralConnection(context, scope, actions, ports);
  assert.equal(server.credentialValues.size, 0);
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
  ui.choices = ["import-json"];
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

test("URL and API key connect without JSON; a private CA is explicitly chosen and no local data is uploaded", async (t) => {
  ui.reset();
  const f = fixture(); t.after(() => fs.rmSync(f.root, {recursive: true, force: true}));
  const server = await centralFixture(f.root); t.after(() => server.close());
  const scope = knowledgeScope({profileId: "direct-key", repoRoot: f.repo, scope: "repository"});
  assert.equal(scope.kind, "repository");
  if (scope.kind !== "repository") throw Error("Expected repository scope");
  const state = new Map<string, unknown>();
  const context = {globalState: {get: (key: string) => state.get(key), update: async (key: string, value: unknown) => {state.set(key, value);}}} as unknown as ExtensionContext;
  const actions = {assertCurrent() {}, async invalidate() {}, async refresh() {}};
  ui.file = path.join(f.root, "public-ca.pem"); fs.writeFileSync(ui.file, server.config.ca);
  ui.inputValues = [server.config.serverUrl, server.secret];
  ui.choices = ["connect", 0];
  await manageCentralConnection(context, scope, actions, {dataDirectory: path.join(f.root, "data"), keys: server.keys, credentials: server.credentials});
  assert.deepEqual(ui.errors, []);
  assert.equal(readSelection(context.globalState, scope)?.mode, "centralized");
  assert.equal(ui.inputs[0]?.password, undefined);
  assert.equal(ui.inputs[1]?.password, true);
  assert(ui.messages.some(m => m.includes("CA certificate")));
  assert(!JSON.stringify([...state]).includes(server.secret));
  assert.equal(server.credentialValues.size, 1);
  assert.equal(server.submissionCalls, 0);
  assert(server.requestMetadata.some(r => r.route.endsWith("/client-auth/connection-options")));
  assert(server.requestMetadata.every(r => r.method === "GET" && r.bodyBytes === 0));
});


test("API-key discovery preserves TLS, audience, revocation, no-redirect and cancellation boundaries", async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, {recursive: true, force: true}));
  const {discoverCentralConnections, CentralDiscoveryTlsError, validateCentralCa} = await import('@gcr/client-core');
  const server = await centralFixture(f.root); t.after(() => server.close());
  const discover = (signal?: AbortSignal) => discoverCentralConnections(server.config.serverUrl, server.secret, 'commit-defender', {ca: server.config.ca, signal});
  await assert.rejects(discoverCentralConnections(server.config.serverUrl, server.secret, 'commit-defender'), CentralDiscoveryTlsError);
  assert.equal(server.calls, 0, 'no HTTP request or key reaches an untrusted TLS server');
  const options = await discover(); assert.equal(options.repositories.length, 1);
  server.setConnectionOptions({serverUrl: 'https://another.invalid/'});
  await assert.rejects(discover(), {code: 'invalid-binding'});
  server.setConnectionOptions({serverId: 'another-server'});
  await assert.rejects(discover(), {code: 'invalid-binding'});
  server.setConnectionOptions({repositories: [...options.repositories, ...options.repositories]});
  await assert.rejects(discover(), {code: 'invalid-binding'});
  server.setConnectionOptions({repositories: [{...options.repositories[0], tenantId: 'another-tenant'}]});
  await assert.rejects(discover(), {code: 'invalid-binding'});
  server.setConnectionOptions({trustedKeys: [{id: 'private', pem: '-----BEGIN PRIVATE KEY-----'}]});
  await assert.rejects(discover(), {code: 'invalid-binding'});
  server.setConnectionOptions({});
  server.setClientId('gcr-cli'); await assert.rejects(discover(), {code: 'invalid-binding'});
  server.setClientId('commit-defender');
  server.setStatus(403); await assert.rejects(discover(), {code: 'revoked'});
  server.setStatus(401); await assert.rejects(discover(), {code: 'authentication-required'});
  server.setStatus(307); const before = server.calls; await assert.rejects(discover(), {code: 'unavailable'});
  assert.equal(server.calls - before, 2, 'bootstrap plus one request; redirect is never followed');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(discover(controller.signal), {code: 'cancelled'});
  assert.throws(() => validateCentralCa(server.config.ca + '\n-----BEGIN PRIVATE KEY-----'), {code: 'invalid-binding'});
  await assert.rejects(discoverCentralConnections('http://untrusted.invalid', server.secret, 'commit-defender'), {code: 'invalid-binding'});
  assert(server.requestMetadata.every(r => r.method === 'GET' && r.bodyBytes === 0));
  assert.equal(server.submissionCalls, 0);
});
