import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runTests } from "@vscode/test-electron";
import {
  defaultLocalDataDirectory,
  PlatformLocalKeyStore,
} from "@gcr/client-core";
const { chromium } = await import(
  process.env.CD_SUBMISSION_PLAYWRIGHT_MODULE ?? "playwright"
);
const artifact = path.resolve(process.env.CD_SUBMISSION_EXTENSION_PATH ?? ".");
const evidence = path.resolve(
  process.env.CD_SUBMISSION_EVIDENCE ??
    "test-results/P08-submission-native-host.json",
);
const temporary = await mkdtemp(path.join(os.tmpdir(), "cd-submission-host-"));
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
  path.join(workspace, "sum.ts"),
  "export const sum = (a, b) => a + b;\n",
);
git("add", ".");
git("commit", "-m", "base");
await writeFile(
  path.join(workspace, "sum.ts"),
  "export const sum = (a, b) => a - b;\n",
);
git("add", ".");
await mkdir(path.join(temporary, "user-data/User"), { recursive: true });
await writeFile(
  path.join(temporary, "user-data/User/settings.json"),
  JSON.stringify({
    "commitDefender.localProfile": profileId,
    "commitDefender.aiProvider": "codex",
    "commitDefender.model": "gpt-6-astra",
    "commitDefender.reviewReasoningEffort": "xhigh",
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
  extensionTestsPath: path.resolve("out-test/review-submission-host.cjs"),
  extensionTestsEnv: {
    CD_SUBMISSION_WORKSPACE: workspace,
    CD_SUBMISSION_PROFILE: profileId,
    CD_SUBMISSION_EVIDENCE: evidence,
    CD_SUBMISSION_CONTROL: control,
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
    .getByText("Repository repository · User alice", { exact: true })
    .click();
  await until(proof, (p) => p.stage === "panel-open");
  let ui = await frame();
  await until(() => ui.locator("#prepare").isEnabled(), Boolean);
  await ui
    .locator("#message")
    .fill("NATIVE_UI_FEEDBACK <img src=x onerror=alert(1)>");
  await ui.locator("#prepare").click();
  await ui.locator("#previewSection").waitFor({ state: "visible" });
  assert(await ui.locator("#send").isDisabled());
  assert(
    !(await ui.locator("#payload").textContent()).includes(
      "PRIVATE_NATIVE_REVIEW_PROSE",
    ),
  );
  assert.equal(await ui.locator("img").count(), 0);
  await ui.locator("#confirmed").check();
  await ui.locator("#save").click();
  await until(
    () => ui.locator("#status").textContent(),
    (t) => t.includes("Saved to the encrypted outbox"),
  );
  await writeFile(control, JSON.stringify({ reopen: true }));
  await until(proof, (p) => p.stage === "reopened");
  ui = await frame();
  await ui.getByText("View exact content", { exact: true }).click();
  await ui.locator("#previewSection").waitFor({ state: "visible" });
  assert(await ui.locator("#send").isDisabled());
  await ui.locator("#confirmed").check();
  await ui.locator("#memory").click();
  await until(
    () => ui.locator("#status").textContent(),
    (t) => t.startsWith("Local memory candidate saved"),
  );
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
  await writeFile(control, JSON.stringify({ adopt: true }));
  await until(proof, (p) => p.stage === "adopted");
  await ui.locator("#synchronize").click();
  await until(
    () => ui.locator("#syncState").textContent(),
    (t) => t.includes("not in the signed policy yet"),
  );
  assert(await ui.locator("#rereview").isDisabled());
  assert.equal(await ui.locator("img").count(), 0);
  await writeFile(control, JSON.stringify({ publish: true }));
  await until(proof, (p) => p.stage === "published");
  await ui.locator("#synchronize").click();
  await until(() => ui.locator("#rereview").isEnabled(), Boolean);
  assert(
    (await ui.locator("#syncState").textContent()).includes(
      "current criterion revision is present",
    ),
  );
  await ui
    .locator("body")
    .screenshot({ path: evidence.replace(/\.json$/, ".png") });
  await writeFile(control, JSON.stringify({ retire: true }));
  await until(proof, (p) => p.stage === "retired");
  await ui.locator("#rereview").click();
  await until(
    () => ui.locator("#status").textContent(),
    (t) => t.includes("policy or snapshot changed"),
  );
  assert(await ui.locator("#followupSection").isHidden());
  await writeFile(control, JSON.stringify({ reopen: true, finish: true }));
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
    await rm(temporary, { recursive: true, force: true });
    await writeFile(
      evidence,
      JSON.stringify(
        {
          ...p,
          fixtureAndKeysRemoved: true,
          ui: {
            verified: uiPassed,
            preview: uiPassed,
            confirmation: uiPassed,
            noHtmlInjection: uiPassed,
            outboxReopen: uiPassed,
            localCandidate: uiPassed,
            explicitSubmission: uiPassed,
            pendingStatus: uiPassed,
            publicationRequired: uiPassed,
            explicitSynchronization: uiPassed,
            retiredCriterionPreventsRereview: uiPassed,
          },
        },
        null,
        2,
      ),
    );
  } else process.stderr.write(`Live host fixture retained: ${temporary}\n`);
}
