import assert from "node:assert/strict";
import { countedCodexLauncher } from "./helpers/counted-codex.mjs";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { runTests } from "@vscode/test-electron";
import {
  callLocalService,
  defaultLocalDataDirectory,
  PlatformLocalKeyStore,
  LocalRecordStore,
  LocalHistoryStore,
  discoverLocalIdentity,
} from "@gcr/client-core";
const artifact = process.env.CD_EDITOR_EXTENSION_PATH;
const evidence = process.env.CD_EDITOR_EVIDENCE;
const executable = process.env.CD_EDITOR_CODEX ?? "/opt/homebrew/bin/codex";
for (const value of [artifact, evidence, executable])
  assert(value && path.isAbsolute(value));
assert.equal(
  process.env.CD_EDITOR_ALLOW_MODEL,
  "1",
  "Explicit current-account model verification required",
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const temporary = await realpath(
  await mkdtemp(path.join("/tmp", "cd-editor-")),
);
const root = path.join(temporary, "workspace");
const profileId = `cd-editor-${randomUUID()}`;
const invocations = path.join(temporary, "model-exec.txt");
const launcher = path.join(temporary, "counted-codex");
await writeFile(
  evidence,
  JSON.stringify({
    status: "running",
    fixture: temporary,
    profileId,
    startedAt: new Date().toISOString(),
    artifact,
  }),
  { flag: "wx", mode: 0o600 },
);
await writeFile(invocations, "", { flag: "wx", mode: 0o600 });
// Count only model exec entries; never log arguments, prompts, environment or account data.
// exec preserves process-group cancellation and delegates all behavior to the selected binary.
await writeFile(launcher, countedCodexLauncher(executable, invocations), {
  flag: "wx",
  mode: 0o700,
});
const binaryBefore = hash(await readFile(await realpath(executable)));
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
    { encoding: "utf8", stdio: "pipe", timeout: 30000 },
  ).trim();
await mkdir(root);
git("init", "-b", "main");
for (const [name, body] of Object.entries({
  "sum.ts":
    "export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);\n",
  "caller.ts":
    "import { sum } from './sum.ts';\nexport const emptyTotal = () => sum([]);\n",
  "sum.test.ts":
    "import assert from 'node:assert/strict';\nimport { sum } from './sum.ts';\nassert.equal(sum([]), 0);\nassert.equal(sum([1, 2]), 3);\n",
  "package.json": '{"private":true,"type":"module"}\n',
}))
  await writeFile(path.join(root, name), body);
git("add", ".");
git("commit", "-m", "Owned editor Save baseline");
await mkdir(path.join(temporary, "user-data/User"), { recursive: true });
await writeFile(
  path.join(temporary, "user-data/User/settings.json"),
  JSON.stringify({
    "commitDefender.localProfile": profileId,
    "commitDefender.aiProvider": "codex",
    "commitDefender.model": "gpt-6-astra",
    "commitDefender.reviewReasoningEffort": "xhigh",
    "commitDefender.codexPath": launcher,
    "commitDefender.serviceNodePath": process.execPath,
    "commitDefender.reviewMode": "standalone",
    "commitDefender.runOnSave": true,
    "commitDefender.runOnStage": false,
    "commitDefender.runOnCommit": false,
    "commitDefender.runOnPush": false,
    "commitDefender.reviewAutoSaves": false,
    "commitDefender.reviewExternalChanges": true,
    "commitDefender.automaticReviewsPaused": false,
    "commitDefender.fileTimeoutSeconds": 600,
    "commitDefender.directoryTimeoutSeconds": 600,
    "commitDefender.preCommitHook": "disable",
    "commitDefender.hookReviewWaitSeconds": 0,
    "commitDefender.automaticSaveIntervalSeconds": 10,
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "workbench.startupEditor": "none",
    "files.autoSave": "off",
  }),
);
const processRows = () =>
  execFileSync("ps", ["-axo", "pid=,ppid=,stat=,args="], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      return m
        ? [{ pid: Number(m[1]), parent: Number(m[2]), state: m[3], args: m[4] }]
        : [];
    });
const owned = new Map();
const remember = () => {
  const rows = processRows();
  const owners = new Set(
    rows
      .filter((r) => r.args.includes(temporary) || r.args.includes(profileId))
      .map((r) => r.pid),
  );
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows)
      if (owners.has(row.parent) && !owners.has(row.pid)) {
        owners.add(row.pid);
        changed = true;
      }
  }
  for (const row of rows)
    if (owners.has(row.pid)) owned.set(row.pid, hash(row.args));
};
const monitor = setInterval(remember, 500);
monitor.unref();
let nativeExitObserved = false;
try {
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
    extensionDevelopmentPath: artifact,
    extensionTestsPath: path.resolve("out-test/editor-save-host.cjs"),
    extensionTestsEnv: {
      CD_EDITOR_WORKSPACE: root,
      CD_EDITOR_PROFILE: profileId,
      CD_EDITOR_EVIDENCE: evidence,
      CD_EDITOR_INVOCATIONS: invocations,
    },
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
    ],
  }).finally(() => {
    nativeExitObserved = true;
  });
  const proof = JSON.parse(await readFile(evidence, "utf8"));
  assert.equal(proof.status, "host-ready-to-close");
  const checkpoint = () =>
    writeFile(evidence, JSON.stringify(proof, null, 2) + "\n", { mode: 0o600 });
  const waitFor = async (read, ready) => {
    let nextLog = Date.now() + 30000;
    for (;;) {
      const value = await read();
      if (ready(value)) return value;
      if (Date.now() > nextLog) {
        await checkpoint();
        process.stdout.write("Observing the same detached Save review.\n");
        nextLog = Date.now() + 30000;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };
  const watch = async () =>
    (
      await callLocalService({ profileId }, { action: "watch-status", root })
    )[0];
  const detached = await waitFor(watch, (value) => value.editorSessions === 0);
  assert.equal(detached.editorTransition.kind, "clean-detach");
  proof.cleanEditorDetach = true;
  const duringExit = await callLocalService(
    { profileId },
    { action: "job", id: proof.manualReceiptId },
  );
  assert.equal(duringExit.state, "running");
  proof.manualRunningAfterHostExit = true;
  const identity = discoverLocalIdentity(root, profileId);
  const scope = {
    kind: "repository",
    profileId,
    repositoryKey: identity.repositoryKey,
    worktreeKey: identity.worktreeKey,
  };
  const reportFor = async (id) => {
    const job = await waitFor(
      () => callLocalService({ profileId }, { action: "job", id }),
      (value) => !["queued", "running"].includes(value.state),
    );
    assert.equal(job.state, "finished");
    assert.equal(job.result.status, "completed");
    const records = await LocalRecordStore.open({ scope });
    try {
      const report = await new LocalHistoryStore(records).getReview(
        job.result.runId,
      );
      assert.equal(report.status, "completed");
      assert.equal(report.trigger, "save");
      assert.equal(report.identity.executor.id, "codex-account");
      assert(report.findings.length > 0);
      return report;
    } finally {
      records.close();
    }
  };
  proof.manualReport = await reportFor(proof.manualReceiptId);
  proof.uiReport = await reportFor(proof.uiReceiptId);
  await checkpoint();
  await writeFile(
    path.join(root, "sum.ts"),
    "// External write after native VS Code closed\nexport const sum = (values: number[]) => values.reduce((a, b) => a - b, 0);\n",
  );
  const external = await waitFor(
    watch,
    (value) => value.receipt && value.receipt.id !== proof.manualReceiptId,
  );
  proof.externalReceiptId = external.receipt.id;
  proof.externalReport = await reportFor(proof.externalReceiptId);
  assert.equal(
    (await readFile(invocations, "utf8"))
      .split("\n")
      .filter((line) => line === "review-exec").length,
    3,
  );
  proof.status = "verified";
  await checkpoint();
} catch (error) {
  const proof = JSON.parse(await readFile(evidence, "utf8"));
  proof.status = "failed";
  proof.driverError =
    error instanceof Error ? error.message : "Native driver failed";
  await writeFile(evidence, JSON.stringify(proof, null, 2) + "\n");
  process.exitCode = 1;
} finally {
  const proof = JSON.parse(await readFile(evidence, "utf8"));
  proof.nativeExitObserved = nativeExitObserved;
  proof.launcherSha256 = hash(await readFile(launcher));
  proof.modelExecInvocations = (await readFile(invocations, "utf8"))
    .trim()
    .split("\n")
    .filter((line) => line === "review-exec").length;
  proof.selectedBinarySha256 = binaryBefore;
  proof.selectedBinaryUnchanged =
    binaryBefore === hash(await readFile(await realpath(executable)));
  try {
    const status = await callLocalService({ profileId }, { action: "status" });
    proof.serviceAtShutdown = { pid: status.pid, jobs: status.jobs };
    // Preserve a live model/request after observer failure; never cancel because observation expired.
    if (!status.jobs.some((job) => ["running", "queued"].includes(job.state))) {
      await callLocalService({ profileId }, { action: "stop" });
      proof.serviceStopRequested = true;
    }
  } catch (error) {
    proof.serviceObservation = error.code ?? "unconfirmed";
  }
  const deadline = Date.now() + 60000;
  let live;
  do {
    remember();
    live = processRows().filter(
      (r) => !r.state.startsWith("Z") && owned.get(r.pid) === hash(r.args),
    );
    if (!live.length || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (true);
  clearInterval(monitor);
  proof.trackedProcesses = owned.size;
  proof.liveOwnedProcesses = live.map((r) => r.pid);
  proof.artifactHashes = {};
  for (const file of [
    "package.json",
    "out/extension.js",
    "out/standalone-review-worker.js",
    "out/advisory-hook.cjs",
    "out/gcr-service/main.mjs",
  ])
    proof.artifactHashes[file] = hash(
      await readFile(path.join(artifact, file)),
    );
  if (proof.status === "verified" && nativeExitObserved && !live.length) {
    const keys = new PlatformLocalKeyStore();
    let removed = 0;
    for (const area of ["", "review-requests", "local-service"]) {
      const directory = path.join(
        defaultLocalDataDirectory(),
        area,
        "profiles",
        profileId,
      );
      try {
        const ref = JSON.parse(
          await readFile(path.join(directory, "local/key-ref.json"), "utf8"),
        );
        assert.equal(ref.profileId, profileId);
        assert.match(ref.id, /^[a-f0-9-]{36}$/);
        await keys.remove(`${profileId}.${ref.id}`);
        removed++;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await rm(directory, { recursive: true, force: true });
    }
    const configPath = path.join(root, ".git/config");
    proof.hookDirectory = path.join(
      defaultLocalDataDirectory(),
      "managed-hooks",
      hash(configPath),
    );
    await rm(proof.hookDirectory, { recursive: true, force: true });
    await rm(temporary, { recursive: true, force: true });
    proof.ownedKeysRemoved = removed;
    proof.ownedFilesRemoved = true;
    proof.status = "passed";
  } else {
    proof.cleanupPending = true;
    process.exitCode = 1;
  }
  proof.finishedAt = new Date().toISOString();
  await writeFile(evidence, JSON.stringify(proof, null, 2) + "\n", {
    mode: 0o600,
  });
}
