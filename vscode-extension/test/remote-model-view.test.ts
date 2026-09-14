import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { CentralConnections } from "@gcr/client-core";
import {
  prepareRemoteWithUi,
  manageRemoteRequests,
} from "../src/remoteModelView.js";
import { knowledgeScope } from "../src/localKnowledge.js";
import { ui } from "./helpers/vscode-remote.js";
import { fixture } from "./helpers/review-fixture.js";
import { centralFixture } from "./helpers/central-fixture.js";

test("account/effort selection requires the exact panel approval and recovery reads without new submission", async (t) => {
  ui.reset();
  const f = fixture();
  t.after(() => f.cleanup());
  f.write("sum.ts", "export const value = 1;\n");
  f.git("add", ".");
  f.git("commit", "-m", "base");
  f.write("sum.ts", 'export const value = "</pre><script>ATTACK</script>";\n');
  f.git("add", ".");
  const server = await centralFixture(f.root);
  server.remote.enabled = true;
  t.after(() => server.close());
  const scope = knowledgeScope({
    repoRoot: f.repo,
    profileId: "remote-ui",
    scope: "repository",
  });
  const ports = {
    keys: server.keys,
    credentials: server.credentials,
    dataDirectory: path.join(f.root, "data"),
  };
  const manager = await CentralConnections.open({ scope, ...ports });
  t.after(() => manager.close());
  await manager.connect(server.config, server.secret, "commit-defender");
  ui.choices = [0, 0, 0];
  const stop = new AbortController();
  const pending = prepareRemoteWithUi(
    { repoRoot: f.repo, files: ["sum.ts"], scope: "staged" },
    {
      mode: "standalone",
      profileId: "remote-ui",
      provider: "unconfigured",
      model: "",
      reasoningEffort: "",
      executablePath: "/unused",
      workspaceTrusted: true,
      durationMs: 30000,
      excludePatterns: [],
    },
    scope,
    stop.signal,
    () => {},
    ports,
  );
  const deadline = Date.now() + 5000;
  while (!ui.panels.length) {
    assert.ok(Date.now() < deadline, "approval panel");
    await delay(10);
  }
  const panel = ui.panels[0]!;
  if (process.env.CD_REMOTE_APPROVAL_HTML)
    fs.writeFileSync(process.env.CD_REMOTE_APPROVAL_HTML, panel.html);
  assert.equal(server.remote.posts, 0);
  assert.ok(panel.html.includes("&lt;script&gt;ATTACK&lt;/script&gt;"));
  assert.ok(!panel.html.includes("<script>ATTACK"));
  assert.ok(panel.html.includes("fixture-account"));
  assert.ok(panel.html.includes("high"));
  assert.ok(panel.html.includes("source-tool bytes"));
  panel.send({ action: "approve", hash: "0".repeat(64) });
  await delay(20);
  assert.equal(panel.disposed, false);
  assert.equal(server.remote.posts, 0);
  const hash = /hash:"([a-f0-9]{64})"/.exec(panel.html)?.[1];
  assert.ok(hash);
  panel.send({ action: "approve", hash });
  const prepared = await pending;
  t.after(() => prepared.dispose?.());
  assert.equal(panel.disposed, true);
  const result = await prepared.run(new AbortController().signal);
  assert.equal(result.report.gcr?.report.identity.executor.id, "central");
  ui.choices = [0, 0, 1];
  const recovered = await manageRemoteRequests(scope, () => {}, ports);
  assert.equal(recovered?.gcr?.report.runId, result.report.gcr?.report.runId);
  assert.equal(server.remote.posts, 1);
  assert.equal(fs.existsSync(f.capture), false);
});
