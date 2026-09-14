import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:net";
import { runTests } from "@vscode/test-electron";
import {
  startLocalService,
  callLocalService,
  captureLocalSource,
  restoreLocalSource,
  discoverLocalIdentity,
  resolveLocalContext,
  resolveLocalExecutionPolicy,
  runLocalReview,
  executeReviewRequest,
  ReviewRequests,
  LocalRecordStore,
  LocalHistoryStore,
  contentHash,
  defaultLocalDataDirectory,
  PlatformLocalKeyStore,
} from "@gcr/client-core";
const artifact = process.env.CD_RECOVERY_EXTENSION_PATH;
const evidence = process.env.CD_RECOVERY_EVIDENCE;
assert(artifact && path.isAbsolute(artifact));
assert(evidence && path.isAbsolute(evidence));
const { chromium } = await import(process.env.CD_RECOVERY_PLAYWRIGHT_MODULE);
const temporary = await mkdtemp(path.join(os.tmpdir(), "cd-recovery-ui-"));
const root = path.join(temporary, "workspace"),
  control = path.join(temporary, "control.json");
const profileId = `cd-recovery-${randomUUID()}`,
  location = { profileId };
const proof = {
  status: "running",
  profileId,
  artifact,
  syntheticExecutorCalls: 0,
  externalModelCalls: 0,
  fixture: temporary,
};
await writeFile(evidence, JSON.stringify(proof), { flag: "wx", mode: 0o600 });
await mkdir(root);
await writeFile(control, JSON.stringify({ stage: "starting" }));
const git = (...args) =>
  execFileSync(
    "git",
    [
      "-C",
      root,
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      ...args,
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
git("init", "-b", "main");
await writeFile(path.join(root, "a.ts"), "export const value = 1;\n");
git("add", ".");
git("commit", "-m", "Owned recovery baseline");
await writeFile(path.join(root, "a.ts"), "export const value = 2;\n");
git("add", ".");
const storage = (reg) => ({
  scope: {
    kind: "repository",
    profileId,
    repositoryKey: reg.repositoryKey,
    worktreeKey: reg.worktreeKey,
  },
});
const descriptor = {
  id: "fixture",
  version: "1",
  model: "fixture",
  configHash: contentHash("recovery-ui"),
  capabilities: {
    available: true,
    sourceIsolation: "fixed-source-only",
    cancellation: true,
    timeout: true,
    childProcessCleanup: true,
    outputTokenLimit: false,
  },
};
const service = await startLocalService({
  ...location,
  run: async (input) => {
    const snapshot = restoreLocalSource(input.source),
      records = await LocalRecordStore.open(storage(input.registration)),
      history = new LocalHistoryStore(records);
    try {
      const client = discoverLocalIdentity(root, profileId),
        context = await resolveLocalContext({ client, snapshot, stores: [] });
      const policy = resolveLocalExecutionPolicy({
        context,
        snapshot,
        executor: descriptor,
        workspaceTrusted: true,
        approval: {
          client,
          executor: descriptor,
          paths: ["**"],
          allowBase: true,
          allowRelated: true,
          allowKnowledge: true,
        },
      });
      assert.equal(context.status, "ready");
      assert.equal(policy.status, "ready");
      const result = await executeReviewRequest({
        storage: storage(input.registration),
        identity: policy.policy.identity,
        reason: input.job.trigger,
        signal: input.signal,
        onRequest: input.bindRequest,
        loadReport: (id) => history.getReview(id),
        saveReport: (report) => history.saveReview(report),
        run: (signal) =>
          runLocalReview({
            snapshot,
            context: context.context,
            policy: policy.policy,
            signal,
            executor: {
              descriptor,
              review: async (request) => {
                proof.syntheticExecutorCalls++;
                const reads = await Promise.all(
                  ["source", "base"].map(async (side) =>
                    JSON.parse(
                      await request.source.execute("read_file", {
                        path: "a.ts",
                        side,
                      }),
                    ),
                  ),
                );
                return {
                  model: "fixture",
                  raw: JSON.stringify({
                    summary: "Synthetic recovery fixture",
                    files: [
                      {
                        path: "a.ts",
                        side: "source",
                        complete: true,
                        summary: "Read frozen source and base",
                        readIds: reads.map((r) => r.readId),
                      },
                    ],
                    findings: [],
                    questions: [],
                  }),
                };
              },
            },
          }),
      });
      proof.originalRunId = result.report.runId;
      // Explicit fault fixture: the saved request is finished, but the service receipt remains unconfirmed.
      return {
        exitCode: 2,
        status: result.report.status,
        runId: result.report.runId,
        completionUnconfirmed: true,
      };
    } finally {
      snapshot.close();
      records.close();
    }
  },
  reconcile: async ({ job, registration }) => {
    const queue = await ReviewRequests.open(storage(registration)),
      records = await LocalRecordStore.open(storage(registration)),
      history = new LocalHistoryStore(records);
    try {
      const result = await queue.reconcile(
        job.execution.key,
        job.execution.generation,
        {
          loadReport: (id) => history.getReview(id),
          assertValid: async () => {},
        },
      );
      if (result.report)
        return {
          exitCode: 0,
          status: result.report.status,
          runId: result.report.runId,
        };
    } finally {
      queue.close();
      records.close();
    }
  },
});
await mkdir(path.join(temporary, "user-data/User"), { recursive: true });
await writeFile(
  path.join(temporary, "user-data/User/settings.json"),
  JSON.stringify({
    "commitDefender.localProfile": profileId,
    "commitDefender.aiProvider": "codex",
    "commitDefender.model": "gpt-6-astra",
    "commitDefender.reviewReasoningEffort": "xhigh",
    "commitDefender.codexPath": "/opt/homebrew/bin/codex",
    "commitDefender.serviceNodePath": process.execPath,
    "commitDefender.reviewMode": "standalone",
    "commitDefender.runOnSave": false,
    "commitDefender.runOnStage": false,
    "commitDefender.runOnCommit": true,
    "commitDefender.runOnPush": false,
    "commitDefender.automaticReviewsPaused": false,
    "commitDefender.preCommitHook": "disable",
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "workbench.startupEditor": "none",
  }),
);
const port = await new Promise((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
let terminal = false,
  browser;
const host = runTests({
  vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
  extensionDevelopmentPath: artifact,
  extensionTestsPath: path.resolve("out-test/background-recovery-host.cjs"),
  extensionTestsEnv: { CD_RECOVERY_CONTROL: control },
  launchArgs: [
    root,
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
async function until(read, done, timeout = 120000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (terminal) throw Error("Host exited before expected state");
    if (Date.now() > deadline)
      throw Error("Observation expired; native host was not restarted");
    await new Promise((r) => setTimeout(r, 250));
  }
}
const call = (request) => callLocalService(location, request);
try {
  browser = await until(async () => {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {}
  }, Boolean);
  const registration = await until(
    () => call({ action: "registration", root }),
    (r) => r?.triggers.includes("commit"),
  );
  const source = captureLocalSource({ cwd: root, kind: "index" });
  const frozen = source.freeze();
  source.close();
  const submitted = await call({
    action: "submit",
    input: {
      id: randomUUID(),
      repository: registration.key,
      registrationRevision: registration.revision,
      trigger: "commit",
      source: frozen,
    },
  });
  const interrupted = await until(
    () => call({ action: "job", id: submitted.id }),
    (j) => j.state === "interrupted",
  );
  assert.equal(interrupted.result.completionUnconfirmed, true);
  assert.equal(proof.syntheticExecutorCalls, 1);
  await writeFile(
    path.join(root, "a.ts"),
    "export const changedAfterReview = true;\n",
  );
  const page = browser.contexts()[0].pages()[0];
  await page
    .getByText("CD: 1 interrupted", { exact: false })
    .waitFor({ state: "visible", timeout: 45000 });
  proof.interruptedVisible = true;
  await writeFile(control, JSON.stringify({ stage: "ready" }));
  await until(
    async () => JSON.parse(await readFile(control, "utf8")),
    (s) => s.stage === "picking",
  );
  await page.getByText("workspace · commit", { exact: true }).click();
  const message = page.getByText(
    "Saved review recovered (completed). Open review history to inspect the result.",
    { exact: true },
  );
  await message.waitFor({ state: "visible" });
  proof.recoveryMessageVisible = true;
  await page.screenshot({ path: evidence.replace(/\.json$/, ".png") });
  const recovered = await call({ action: "job", id: submitted.id });
  assert.equal(recovered.state, "finished");
  assert.equal(recovered.result.runId, proof.originalRunId);
  assert.equal(recovered.sourceHash, interrupted.sourceHash);
  assert.equal(proof.syntheticExecutorCalls, 1);
  proof.recovered = {
    id: recovered.id,
    runId: recovered.result.runId,
    status: recovered.result.status,
    sourceHash: recovered.sourceHash,
  };
  // Dismiss this test's notification so the actual command promise can settle.
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click({ timeout: 10000 });
  await message
    .locator(
      'xpath=ancestor::*[contains(@class, "notification-list-item-main-row")]',
    )
    .getByRole("button", { name: /Clear Notification/ })
    .click({ timeout: 10000 });
  await host;
  const outcome = JSON.parse(await readFile(control, "utf8"));
  assert.equal(outcome.stage, "passed");
  proof.host = outcome;
  proof.status = "passed";
} catch (error) {
  proof.status = "failed";
  proof.error = String(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await service.close();
  await service.closed;
  proof.serviceStopped = true;
  if (terminal) {
    const keys = new PlatformLocalKeyStore();
    let removed = 0;
    for (const base of [
      defaultLocalDataDirectory(),
      path.join(defaultLocalDataDirectory(), "review-requests"),
      path.join(defaultLocalDataDirectory(), "local-service"),
    ]) {
      const directory = path.join(base, "profiles", profileId);
      try {
        const ref = JSON.parse(
          await readFile(path.join(directory, "local/key-ref.json"), "utf8"),
        );
        assert.equal(ref.profileId, profileId);
        await keys.remove(`${profileId}.${ref.id}`);
        removed++;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await rm(directory, { recursive: true, force: true });
    }
    proof.ownedKeysRemoved = removed;
    if (proof.status === "passed") {
      await rm(temporary, { recursive: true, force: true });
      proof.ownedFilesRemoved = true;
    }
  } else {
    proof.nativeHostStillLive = true;
  }
  proof.finishedAt = new Date().toISOString();
  proof.extensionSha256 = createHash("sha256")
    .update(await readFile(path.join(artifact, "out/extension.js")))
    .digest("hex");
  await writeFile(evidence, JSON.stringify(proof, null, 2) + "\n");
}
