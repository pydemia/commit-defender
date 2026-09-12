import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: path.join(
      extensionRoot,
      "out-test",
      "extension-host.cjs",
    ),
    extensionTestsEnv: {
      CD_TEST_WORKSPACE: workspace,
      CD_TEST_EVIDENCE_FILE: evidenceFile,
      CD_TEST_PROFILE: profileId,
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
  await rm(temporary, { recursive: true, force: true });
}
