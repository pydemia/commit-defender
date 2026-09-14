import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import * as vscode from "vscode";
export async function run() {
  const extension = vscode.extensions.getExtension("pydemia.commit-defender");
  assert(extension);
  await extension.activate();
  assert(
    (await vscode.commands.getCommands(true)).includes(
      "commitDefender.recoverBackgroundReview",
    ),
  );
  const control = process.env.CD_RECOVERY_CONTROL!;
  const deadline = Date.now() + 180000;
  while (true) {
    const state = JSON.parse(await readFile(control, "utf8"));
    if (state.stage === "ready") break;
    if (Date.now() > deadline)
      throw Error(
        "Recovery fixture did not become ready; host observation expired.",
      );
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await writeFile(
    control,
    JSON.stringify({ stage: "picking", vscode: vscode.version }),
  );
  await vscode.commands.executeCommand(
    "commitDefender.recoverBackgroundReview",
  );
  await vscode.workspace
    .getConfiguration("commitDefender")
    .update("automaticReviewsPaused", true, vscode.ConfigurationTarget.Global);
  await writeFile(
    control,
    JSON.stringify({
      stage: "passed",
      vscode: vscode.version,
      extensionVersion: extension.packageJSON.version,
    }),
  );
}
