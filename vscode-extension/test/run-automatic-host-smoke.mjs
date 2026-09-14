// Requires explicit executable and artifact paths. Uses a temporary VS Code profile.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { runTests } from "@vscode/test-electron";
import {
  defaultLocalDataDirectory,
  PlatformLocalKeyStore,
} from "@gcr/client-core";
import assert from "node:assert/strict";
const extensionRoot = process.cwd(),
  artifact = process.env.CD_AUTO_EXTENSION_PATH,
  executable = process.env.CD_AUTO_CODEX_EXECUTABLE,
  evidence = process.env.CD_AUTO_EVIDENCE;
assert(artifact && path.isAbsolute(artifact));
assert(executable && path.isAbsolute(executable));
assert(evidence && path.isAbsolute(evidence));
const temporary = await mkdtemp(path.join(os.tmpdir(), "cd-auto-host-")),
  workspace = path.join(temporary, "workspace"),
  profileId = `cd-auto-${randomUUID()}`;
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
    {
      stdio: "pipe",
      env: {
        PATH: process.env.PATH,
        HOME: temporary,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    },
  );
try {
  await mkdir(workspace);
  git("init", "-b", "main");
  await writeFile(
    path.join(workspace, "sum.ts"),
    "export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);\n",
  );
  await writeFile(
    path.join(workspace, "caller.ts"),
    "import { sum } from './sum.ts';\nexport const emptyTotal = () => sum([]);\n",
  );
  await writeFile(
    path.join(workspace, "sum.test.ts"),
    "import assert from 'node:assert/strict';\nimport { sum } from './sum.ts';\nassert.equal(sum([]), 0);\nassert.equal(sum([1,2]), 3);\n",
  );
  await writeFile(
    path.join(workspace, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  git("add", ".");
  git("commit", "-m", "base");
  await mkdir(path.join(temporary, "user-data", "User"), { recursive: true });
  await writeFile(
    path.join(temporary, "user-data", "User", "settings.json"),
    JSON.stringify({
      "commitDefender.localProfile": profileId,
      "commitDefender.aiProvider": "codex",
      "commitDefender.model": "gpt-6-astra",
      "commitDefender.reviewReasoningEffort": "xhigh",
      "commitDefender.codexPath": executable,
      "commitDefender.reviewMode": "standalone",
      "commitDefender.runOnSave": false,
      "commitDefender.runOnStage": false,
      "commitDefender.reviewAutoSaves": false,
      "commitDefender.reviewExternalChanges": false,
      "commitDefender.automaticReviewsPaused": false,
      "commitDefender.fileTimeoutSeconds": 180,
      "commitDefender.preCommitHook": "disable",
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
      "files.autoSave": "off",
      "workbench.startupEditor": "none",
    }),
  );
  await runTests({
    vscodeExecutablePath:
      process.env.VSCODE_EXECUTABLE_PATH ||
      "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    extensionDevelopmentPath: artifact,
    extensionTestsPath: path.join(
      extensionRoot,
      "out-test",
      "automatic-host-smoke.cjs",
    ),
    extensionTestsEnv: {
      CD_AUTO_WORKSPACE: workspace,
      CD_AUTO_PROFILE: profileId,
      CD_AUTO_EVIDENCE: evidence,
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
  const keys = new PlatformLocalKeyStore();
  for (const base of [
    defaultLocalDataDirectory(),
    path.join(defaultLocalDataDirectory(), "review-requests"),
  ]) {
    const directory = path.join(base, "profiles", profileId);
    try {
      const reference = JSON.parse(
        await readFile(path.join(directory, "local/key-ref.json"), "utf8"),
      );
      assert.equal(reference.profileId, profileId);
      assert.match(reference.id, /^[a-f0-9-]{36}$/);
      await keys.remove(`${profileId}.${reference.id}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rm(directory, { recursive: true, force: true });
  }
  const contents = await readFile(evidence, "utf8");
  const proof = contents ? JSON.parse(contents) : { status: "setup-failed" };
  proof.cleanup = "completed";
  proof.finishedAt = new Date().toISOString();
  proof.workerSha256 = createHash("sha256")
    .update(
      await readFile(path.join(artifact, "out/standalone-review-worker.js")),
    )
    .digest("hex");
  await writeFile(evidence, JSON.stringify(proof, null, 2) + "\n", {
    mode: 0o600,
  });
  await rm(temporary, { recursive: true, force: true });
}
