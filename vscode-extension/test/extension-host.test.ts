import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { defaultLocalDataDirectory } from "@gcr/client-core";

/** Executed by the real VS Code Extension Host, not by a vscode module mock. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("pydemia.commit-defender");
  assert(extension, "Development extension must be installed");
  await extension.activate();
  assert(extension.isActive, "Extension activation must complete");

  const workspace = process.env.CD_TEST_WORKSPACE;
  assert(workspace);
  assert.equal(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, workspace);
  const config = vscode.workspace.getConfiguration("commitDefender");
  assert.equal(config.get("preCommitHook"), "disable");
  assert.equal(config.get("runOnStage"), false);
  assert.equal(config.get("reviewMode"), "standalone");
  assert.equal(
    config.inspect<string>("localProfile")?.globalValue,
    process.env.CD_TEST_PROFILE,
  );
  const commands = new Set(await vscode.commands.getCommands(true));
  const declared: string[] = extension.packageJSON.contributes.commands.map(
    (command: { command: string }) => command.command,
  );
  for (const command of declared)
    assert(commands.has(command), `Missing command: ${command}`);
  await vscode.commands.executeCommand("commitDefender.clearFindings");
  await vscode.commands.executeCommand("commitDefender.cancel");
  await vscode.commands.executeCommand("commitDefender.refreshLocalHistory");
  assert(
    !existsSync(
      path.join(
        defaultLocalDataDirectory(),
        "profiles",
        process.env.CD_TEST_PROFILE!,
      ),
    ),
  );
  assert(!existsSync(path.join(workspace, ".git", "hooks", "pre-commit")));

  const evidence = {
    status: "passed",
    vscode: vscode.version,
    node: process.versions.node,
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    extensionVersion: extension.packageJSON.version,
    delivery: process.env.CD_TEST_DELIVERY ?? "source-checkout",
    commandCount: declared.length,
    activation: true,
    hookDefault: "disable",
    modelCalled: false,
    checks: [
      "activation",
      "command registration",
      "clear findings",
      "cancel without run",
      "no hook installed",
      "standalone defaults and user profile",
      "empty history refresh creates no local store or OS key",
    ],
  };
  if (process.env.CD_TEST_EVIDENCE_FILE) {
    writeFileSync(
      process.env.CD_TEST_EVIDENCE_FILE,
      JSON.stringify(evidence, null, 2) + "\n",
    );
  }
  console.log(JSON.stringify(evidence));
}
