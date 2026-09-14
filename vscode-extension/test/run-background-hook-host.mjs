import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { runTests } from "@vscode/test-electron";
import {
  callLocalService,
  defaultLocalDataDirectory,
  PlatformLocalKeyStore,
} from "@gcr/client-core";
const artifact = process.env.CD_HOOK_EXTENSION_PATH,
  executable = process.env.CD_HOOK_CODEX,
  evidence = process.env.CD_HOOK_EVIDENCE;
for (const value of [artifact, executable, evidence])
  assert(value && path.isAbsolute(value));
const temporary = await mkdtemp(path.join(os.tmpdir(), "cd-background-hooks-")),
  workspace = path.join(temporary, "workspace"),
  profileId = `cd-hooks-${randomUUID()}`;
await writeFile(evidence, "", { flag: "wx", mode: 0o600 });
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
try {
  await mkdir(workspace);
  git("init", "-b", "main");
  const files = {
    "sum.ts":
      "export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);\n",
    "caller.ts":
      "import { sum } from './sum.ts';\nexport const emptyTotal = () => sum([]);\n",
    "sum.test.ts":
      "import assert from 'node:assert/strict';\nimport { sum } from './sum.ts';\nassert.equal(sum([]), 0);\nassert.equal(sum([1,2]), 3);\n",
    "unrelated.ts": "export const unrelated = 1;\n",
    "package.json": '{"private":true,"type":"module"}\n',
  };
  for (const [name, body] of Object.entries(files))
    await writeFile(path.join(workspace, name), body);
  git("add", ".");
  git("commit", "-m", "base");
  git("init", "--bare", path.join(temporary, "remote.git"));
  git("remote", "add", "fixture", path.join(temporary, "remote.git"));
  git("push", "fixture", "main");
  await mkdir(path.join(temporary, "user-data/User"), { recursive: true });
  await writeFile(
    path.join(temporary, "user-data/User/settings.json"),
    JSON.stringify({
      "commitDefender.localProfile": profileId,
      "commitDefender.aiProvider": "codex",
      "commitDefender.model": "gpt-6-astra",
      "commitDefender.reviewReasoningEffort": "xhigh",
      "commitDefender.codexPath": executable,
      "commitDefender.serviceNodePath": process.execPath,
      "commitDefender.reviewMode": "standalone",
      "commitDefender.runOnSave": false,
      "commitDefender.runOnStage": false,
      "commitDefender.runOnCommit": false,
      "commitDefender.runOnPush": false,
      "commitDefender.preCommitHook": "disable",
      "commitDefender.automaticReviewsPaused": false,
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
      "workbench.startupEditor": "none",
    }),
  );
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
    extensionDevelopmentPath: artifact,
    extensionTestsPath: path.resolve("out-test/background-hook-host.cjs"),
    extensionTestsEnv: {
      CD_HOOK_WORKSPACE: workspace,
      CD_HOOK_PROFILE: profileId,
      CD_HOOK_EVIDENCE: evidence,
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
    ],
  });
} finally {
  const contents = await readFile(evidence, "utf8"),
    proof = contents ? JSON.parse(contents) : { status: "setup-failed" };
  let stopped = false;
  try {
    const status = await callLocalService({ profileId }, { action: "status" });
    await callLocalService({ profileId }, { action: "stop" });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try {
        process.kill(status.pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") {
          stopped = true;
          break;
        }
        throw error;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch {
    /* A failed observation does not prove the service is stopped. */
  }
  if (stopped) {
    const keys = new PlatformLocalKeyStore();
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
        assert.match(ref.id, /^[a-f0-9-]{36}$/);
        await keys.remove(`${profileId}.${ref.id}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await rm(directory, { recursive: true, force: true });
    }
    proof.cleanup = "service stopped; owned profile keys and records removed";
    if (proof.status === "verified") {
      if (proof.hookDirectory) {
        assert(
          path
            .resolve(proof.hookDirectory)
            .startsWith(
              path.join(defaultLocalDataDirectory(), "managed-hooks") +
                path.sep,
            ),
        );
        await rm(proof.hookDirectory, { recursive: true, force: true });
      }
      await rm(temporary, { recursive: true, force: true });
    }
  } else {
    proof.cleanup = "service outcome unconfirmed; owned fixture retained";
    proof.fixture = temporary;
    process.exitCode = 1;
  }
  proof.finishedAt = new Date().toISOString();
  proof.extensionSha256 = createHash("sha256")
    .update(await readFile(path.join(artifact, "out/extension.js")))
    .digest("hex");
  await writeFile(evidence, JSON.stringify(proof, null, 2) + "\n", {
    mode: 0o600,
  });
}
