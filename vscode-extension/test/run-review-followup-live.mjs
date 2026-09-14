import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { runTests } from "@vscode/test-electron";
import {
  defaultLocalDataDirectory,
  PlatformLocalKeyStore,
} from "@gcr/client-core";
const { chromium } = await import(
  process.env.CD_SUBMISSION_PLAYWRIGHT_MODULE ?? "playwright"
);
if (
  process.env.CD_FOLLOWUP_ALLOW_MODEL !== "1" ||
  !process.env.CD_FOLLOWUP_FIXTURE_MODULE
)
  throw Error(
    "An explicitly authorized live fixture and model run are required",
  );
const fixtureModule = await import(
  pathToFileURL(process.env.CD_FOLLOWUP_FIXTURE_MODULE).href
);
const artifact = path.resolve(process.env.CD_SUBMISSION_EXTENSION_PATH ?? ".");
const evidence = path.resolve(
  process.env.CD_SUBMISSION_EVIDENCE ??
    "test-results/P08-followup-live-host.json",
);
const temporary = await mkdtemp(path.join(os.tmpdir(), "cd-followup-live-"));
const workspace = path.join(temporary, "workspace"),
  profileId = `cd-submission-${randomUUID()}`,
  control = path.join(temporary, "control.json");
await mkdir(workspace);
const git = (...args) =>
  execFileSync(
    "git",
    [
      "-C",
      workspace,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { stdio: "pipe" },
  );
git("init", "-b", "main");
await writeFile(
  path.join(workspace, "cache.py"),
  "_cache = {}\n\ndef lookup(tenant, key, load):\n    cache_key = (tenant, key)\n    if cache_key not in _cache:\n        _cache[cache_key] = load(tenant, key)\n    return _cache[cache_key]\n",
);
await writeFile(
  path.join(workspace, "caller.py"),
  "from cache import lookup\n\ndef get_document(tenant, document_id, database):\n    return lookup(tenant, document_id, database.read_document)\n",
);
await writeFile(
  path.join(workspace, "test_cache.py"),
  "from cache import lookup\n\ndef test_tenant_isolation():\n    load = lambda tenant, key: tenant + ':' + key\n    assert lookup('tenant-a', 'doc-1', load) == 'tenant-a:doc-1'\n    assert lookup('tenant-b', 'doc-1', load) == 'tenant-b:doc-1'\n",
);
git("add", ".");
git("commit", "-m", "Owned tenant cache baseline");
await writeFile(
  path.join(workspace, "cache.py"),
  (await readFile(path.join(workspace, "cache.py"), "utf8")).replace(
    "cache_key = (tenant, key)",
    "cache_key = key",
  ),
);
git("add", "cache.py");
await mkdir(path.join(temporary, "user-data/User"), { recursive: true });
await writeFile(
  path.join(temporary, "user-data/User/settings.json"),
  JSON.stringify({
    "commitDefender.localProfile": profileId,
    "commitDefender.aiProvider": "codex",
    "commitDefender.model": "gpt-6-astra",
    "commitDefender.reviewReasoningEffort": "xhigh",
    "commitDefender.codexPath": "/opt/homebrew/bin/codex",
    "commitDefender.fileTimeoutSeconds": 600,
    "commitDefender.directoryTimeoutSeconds": 600,
    "commitDefender.runOnSave": false,
    "commitDefender.runOnStage": false,
    "commitDefender.runOnCommit": false,
    "commitDefender.runOnPush": false,
    "commitDefender.preCommitHook": "disable",
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "workbench.startupEditor": "none",
  }),
);
let central;
try {
  central = await fixtureModule.setup();
} catch (error) {
  await fixtureModule.cleanup();
  await rm(temporary, { recursive: true });
  throw error;
}
const configurationFile = path.join(temporary, "connection.json");
await writeFile(configurationFile, JSON.stringify(central.configuration), {
  mode: 0o600,
});
await rm(evidence, { force: true });
const port = await new Promise((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
let terminal = false,
  browser,
  uiPassed = false;
const host = runTests({
  vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
  extensionDevelopmentPath: artifact,
  extensionTestsPath: path.resolve("out-test/review-followup-live-host.cjs"),
  extensionTestsEnv: {
    CD_SUBMISSION_WORKSPACE: workspace,
    CD_SUBMISSION_PROFILE: profileId,
    CD_SUBMISSION_EVIDENCE: evidence,
    CD_SUBMISSION_CONTROL: control,
    CD_FOLLOWUP_CONFIGURATION: configurationFile,
  },
  launchArgs: [
    workspace,
    "--user-data-dir",
    path.join(temporary, "user-data"),
    "--extensions-dir",
    path.join(temporary, "extensions"),
    "--disable-extensions",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-updates",
    "--disable-telemetry",
    `--remote-debugging-port=${port}`,
  ],
}).finally(() => {
  terminal = true;
});
host.catch(() => {});
async function until(read, done, timeout = 180000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (terminal) throw Error("Host is terminal before expected UI state");
    if (Date.now() > deadline)
      throw Error("UI observation expired; host was not restarted");
    await new Promise((r) => setTimeout(r, 300));
  }
}
const proof = async () => {
  try {
    return JSON.parse(await readFile(evidence, "utf8"));
  } catch {
    return {};
  }
};
const frame = () =>
  until(async () => {
    for (const c of browser.contexts())
      for (const p of c.pages())
        for (const f of p.frames()) {
          try {
            if (await f.locator("#previewSection").count()) return f;
          } catch {}
        }
  }, Boolean);
try {
  browser = await until(async () => {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {}
  }, Boolean);
  await until(proof, (p) => p.stage === "select-connection");
  const page = browser.contexts()[0].pages()[0];
  await page.getByText("Select connected repository…", { exact: true }).click();
  await page
    .getByText(
      `Repository ${central.configuration.config.repositoryId} · User ${central.configuration.userId}`,
      { exact: true },
    )
    .click();
  await until(proof, (p) => p.stage === "panel-open");
  let ui = await frame();
  await until(() => ui.locator("#prepare").isEnabled(), Boolean);
  await ui.locator("#feedbackKind").selectOption("judgment");
  await ui
    .locator("#message")
    .fill(
      "Owned native CD verification: inspect tenant isolation in the synthetic cache key. Initial report is synthetic; no model or test execution is claimed for this submission.",
    );
  await ui.locator("#prepare").click();
  await ui.locator("#previewSection").waitFor({ state: "visible" });
  assert(await ui.locator("#send").isDisabled());
  await ui.locator("#confirmed").check();
  await ui.locator("#send").click();
  await until(
    () => ui.locator("#status").textContent(),
    (t) => t.startsWith("Received by the server"),
  );
  await ui.getByText("Check central review status", { exact: true }).click();
  await until(
    () => ui.locator("#followupState").textContent(),
    (t) => t.includes("awaiting central review"),
  );
  assert(await ui.locator("#rereview").isDisabled());
  const adoption = await central.adopt();
  await ui.locator("#synchronize").click();
  await until(() => ui.locator("#rereview").isEnabled(), Boolean);
  assert(
    (await ui.locator("#syncState").textContent()).includes(
      "current criterion revision is present",
    ),
  );
  await ui
    .locator("#followupSection")
    .screenshot({ path: evidence.replace(/\.json$/, ".png") });
  await writeFile(
    control,
    JSON.stringify({
      review: true,
      ruleId: adoption.ruleId,
      snapshotId: adoption.snapshotId,
    }),
  );
  await ui.locator("#rereview").click();
  await until(proof, (p) => ["passed", "failed"].includes(p.status), 750000);
  await host;
  assert.equal((await proof()).status, "passed");
  uiPassed = true;
} finally {
  if (browser) await browser.close().catch(() => {});
  // Cleanup is permitted only after the native host is known to have stopped.
  if (terminal) {
    const p = await proof();
    assert(
      p.credentialRemoved,
      "Keep fixture until credential cleanup is confirmed",
    );
    for (const base of [
      defaultLocalDataDirectory(),
      ...[
        "central-connections",
        "review-requests",
        `central-cache/${p.connectionId}`,
        `review-submissions/${p.connectionId}`,
      ].map((d) => path.join(defaultLocalDataDirectory(), d)),
    ]) {
      const dir = path.join(base, "profiles", profileId);
      try {
        const ref = JSON.parse(
          await readFile(path.join(dir, "local/key-ref.json"), "utf8"),
        );
        assert.equal(ref.profileId, profileId);
        await new PlatformLocalKeyStore().remove(`${profileId}.${ref.id}`);
        await rm(dir, { recursive: true, force: true });
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    const centralCleanup = await fixtureModule.cleanup();
    await rm(temporary, { recursive: true, force: true });
    await writeFile(
      evidence,
      JSON.stringify(
        {
          ...p,
          fixtureAndKeysRemoved: true,
          centralCleanup,
          ui: {
            verified: uiPassed,
            explicitSubmission: uiPassed,
            realPrismApproval: uiPassed,
            explicitSynchronization: uiPassed,
            explicitModelRereview: uiPassed,
          },
        },
        null,
        2,
      ),
    );
  } else process.stderr.write(`Live host fixture retained: ${temporary}\n`);
}
