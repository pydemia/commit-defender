import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { runTests } from "@vscode/test-electron";
import {
  defaultLocalDataDirectory,
  PlatformLocalKeyStore,
  discoverLocalIdentity,
  LocalRecordStore,
  observeAutomaticRepository,
} from "@gcr/client-core";
const artifact = process.env.CD_CATCHUP_EXTENSION_PATH,
  evidence = process.env.CD_CATCHUP_EVIDENCE;
assert(artifact && path.isAbsolute(artifact));
assert(evidence && path.isAbsolute(evidence));
assert.equal(
  process.env.CD_CATCHUP_ALLOW_MODEL,
  "1",
  "This native test explicitly uses the current Codex account once.",
);
const resumeFile = process.env.CD_CATCHUP_RESUME_EVIDENCE;
const previous = resumeFile
  ? JSON.parse(await readFile(resumeFile, "utf8"))
  : undefined;
if (previous) {
  assert.match(previous.profileId, /^cd-catchup-[a-f0-9-]{36}$/);
  assert.equal(path.dirname(previous.fixture), os.tmpdir().replace(/\/$/, ""));
  assert(path.basename(previous.fixture).startsWith("cd-stage-catchup-"));
  assert.equal(previous.phases.review.report.status, "completed");
}
const temporary =
  previous?.fixture ??
  (await mkdtemp(path.join(os.tmpdir(), "cd-stage-catchup-")));
const root = path.join(temporary, "workspace"),
  profileId = previous?.profileId ?? `cd-catchup-${randomUUID()}`;
if (previous) {
  const observed = await observeAutomaticRepository(root),
    client = discoverLocalIdentity(root, profileId);
  const records = await LocalRecordStore.open({
    scope: {
      kind: "repository",
      profileId,
      repositoryKey: client.repositoryKey,
      worktreeKey: client.worktreeKey,
    },
  });
  try {
    const row = await records.read(
      "settings",
      "automatic-stage-observation-v1",
    );
    assert(row && !row.deleted && row.value.enabled);
    assert.equal(row.value.observed.fingerprint, observed.fingerprint);
    assert.deepEqual(row.value.pendingPaths, []);
  } finally {
    records.close();
  }
}
await writeFile(
  evidence,
  JSON.stringify({
    ...(previous ?? {}),
    status: "running",
    profileId,
    fixture: temporary,
    phases: previous?.phases ?? {},
    ...(previous ? { resumedFrom: resumeFile } : {}),
  }),
  { flag: "wx", mode: 0o600 },
);
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
if (!previous) {
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
  git("commit", "-m", "Owned stage catch-up baseline");
  await mkdir(path.join(temporary, "user-data/User"), { recursive: true });
  await writeFile(
    path.join(temporary, "user-data/User/settings.json"),
    JSON.stringify({
      "commitDefender.localProfile": profileId,
      "commitDefender.aiProvider": "codex",
      "commitDefender.model": "gpt-6-astra",
      "commitDefender.reviewReasoningEffort": "xhigh",
      "commitDefender.codexPath": "/opt/homebrew/bin/codex",
      "commitDefender.reviewMode": "standalone",
      "commitDefender.runOnSave": false,
      "commitDefender.runOnStage": true,
      "commitDefender.runOnCommit": false,
      "commitDefender.runOnPush": false,
      "commitDefender.reviewAutoSaves": false,
      "commitDefender.reviewExternalChanges": false,
      "commitDefender.automaticReviewsPaused": false,
      "commitDefender.fileTimeoutSeconds": 600,
      "commitDefender.directoryTimeoutSeconds": 600,
      "commitDefender.preCommitHook": "disable",
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
      "workbench.startupEditor": "none",
      "files.autoSave": "off",
    }),
  );
}
let hostStopped = true;
const ownedProcesses = new Map();
const processRows = () =>
  execFileSync("ps", ["-axo", "pid=,ppid=,stat=,args="], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      return match
        ? [
            {
              pid: Number(match[1]),
              parent: Number(match[2]),
              state: match[3],
              args: match[4],
            },
          ]
        : [];
    });
const rememberProcesses = () => {
  const rows = processRows(),
    owners = new Set(
      rows.filter((row) => row.args.includes(temporary)).map((row) => row.pid),
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
    if (owners.has(row.pid))
      ownedProcesses.set(
        row.pid,
        createHash("sha256").update(row.args).digest("hex"),
      );
};
const monitor = setInterval(rememberProcesses, 500);
monitor.unref();
try {
  for (const phase of previous
    ? ["reopen"]
    : ["baseline", "review", "reopen"]) {
    if (phase === "review") {
      await writeFile(
        path.join(root, "sum.ts"),
        "export const sum = (values: number[]) => values.reduce((a, b) => a + b);\n",
      );
      git("add", "sum.ts");
    }
    hostStopped = false;
    await runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
      extensionDevelopmentPath: artifact,
      extensionTestsPath: path.resolve("out-test/stage-catchup-host.cjs"),
      extensionTestsEnv: {
        CD_CATCHUP_WORKSPACE: root,
        CD_CATCHUP_PROFILE: profileId,
        CD_CATCHUP_PHASE: phase,
        CD_CATCHUP_EVIDENCE: evidence,
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
      hostStopped = true;
    });
  }
  const proof = JSON.parse(await readFile(evidence, "utf8"));
  proof.status = previous ? "reopen-verified" : "passed";
  await writeFile(evidence, JSON.stringify(proof, null, 2) + "\n");
} catch (error) {
  const proof = JSON.parse(await readFile(evidence, "utf8"));
  proof.status = "failed";
  proof.error =
    error instanceof Error ? error.message : "Native verification failed.";
  await writeFile(evidence, JSON.stringify(proof, null, 2) + "\n");
  throw error;
} finally {
  clearInterval(monitor);
  const proof = JSON.parse(await readFile(evidence, "utf8"));
  proof.hostStopped = hostStopped;
  const cleanupDeadline = Date.now() + 60000;
  let live = [];
  do {
    live = processRows().filter(
      (row) =>
        !row.state.startsWith("Z") &&
        ownedProcesses.get(row.pid) ===
          createHash("sha256").update(row.args).digest("hex"),
    );
    if (!live.length || Date.now() >= cleanupDeadline) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (true);
  proof.trackedNativeProcesses = ownedProcesses.size;
  proof.liveOwnedProcesses = live.map((row) => row.pid);
  if (hostStopped && !live.length) {
    const keys = new PlatformLocalKeyStore();
    let removed = 0;
    for (const base of [
      defaultLocalDataDirectory(),
      path.join(defaultLocalDataDirectory(), "review-requests"),
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
    if (["passed", "reopen-verified"].includes(proof.status)) {
      await rm(temporary, { recursive: true, force: true });
      proof.ownedFilesRemoved = true;
    }
  } else {
    proof.cleanupPending = true;
    process.exitCode = 1;
  }
  proof.finishedAt = new Date().toISOString();
  proof.extensionSha256 = createHash("sha256")
    .update(await readFile(path.join(artifact, "out/extension.js")))
    .digest("hex");
  proof.workerSha256 = createHash("sha256")
    .update(
      await readFile(path.join(artifact, "out/standalone-review-worker.js")),
    )
    .digest("hex");
  await writeFile(evidence, JSON.stringify(proof, null, 2) + "\n");
}
