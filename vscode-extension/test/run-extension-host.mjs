import {
  defaultLocalDataDirectory,
  PlatformLocalKeyStore,
} from "@gcr/client-core";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";
import { randomUUID } from "node:crypto";

const extensionRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const temporary = await mkdtemp(path.join(tmpdir(), "commit-defender-host-"));
const workspace = path.join(temporary, "workspace");
const version = process.env.VSCODE_TEST_VERSION || "stable";
const executable = process.env.VSCODE_EXECUTABLE_PATH;
const profileId = `cd-host-${randomUUID()}`;
const evidenceFile = path.join(
  extensionRoot,
  "test-results",
  `extension-host-${executable ? "installed" : version}.json`,
);
try {
  await mkdir(workspace);
  execFileSync("git", ["init", "-b", "main"], {
    cwd: workspace,
    stdio: "ignore",
  });
  await mkdir(path.join(workspace, ".vscode"));
  await writeFile(
    path.join(workspace, ".vscode", "settings.json"),
    JSON.stringify({
      "commitDefender.preCommitHook": "disable",
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
    }),
  );
  await mkdir(path.join(temporary, "user-data", "User"), { recursive: true });
  await writeFile(
    path.join(temporary, "user-data", "User", "settings.json"),
    JSON.stringify({
      "commitDefender.localProfile": profileId,
      "commitDefender.runOnStage": false,
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
    }),
  );
  await writeFile(
    path.join(workspace, "fixture.ts"),
    "export const baseline = true;\n",
  );
  await mkdir(path.dirname(evidenceFile), { recursive: true });
  // Remove stale success evidence before running this version again.
  await rm(evidenceFile, { force: true });
  await runTests({
    version,
    ...(executable ? { vscodeExecutablePath: executable } : {}),
    extensionDevelopmentPath: path.resolve(
      process.env.CD_TEST_EXTENSION_PATH ?? extensionRoot,
    ),
    extensionTestsPath: path.join(
      extensionRoot,
      "out-test",
      "extension-host.cjs",
    ),
    extensionTestsEnv: {
      CD_TEST_WORKSPACE: workspace,
      CD_TEST_EVIDENCE_FILE: evidenceFile,
      CD_TEST_PROFILE: profileId,
      CD_TEST_ACTIVITY_FIXTURE: process.env.CD_TEST_ACTIVITY_FIXTURE ?? "0",
      CD_TEST_MODEL_SETUP: process.env.CD_TEST_MODEL_SETUP ?? "0",
      CD_TEST_DELIVERY: process.env.CD_TEST_EXTENSION_PATH
        ? "packaged-extension"
        : "source-checkout",
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
  console.log(`Extension Host evidence: ${evidenceFile}`);
} finally {
  if (process.env.CD_TEST_ACTIVITY_FIXTURE === "1") {
    const directory = path.join(
      defaultLocalDataDirectory(),
      "profiles",
      profileId,
    );
    let reference;
    try {
      reference = JSON.parse(
        await readFile(path.join(directory, "key-ref.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (reference) {
      if (
        reference.profileId !== profileId ||
        !/^[a-f0-9-]{36}$/.test(reference.id)
      )
        throw Error("Unexpected fixture key reference");
      await new PlatformLocalKeyStore().remove(`${profileId}.${reference.id}`);
    }
    await rm(directory, { recursive: true, force: true });
  }
  await rm(temporary, { recursive: true, force: true });
}
