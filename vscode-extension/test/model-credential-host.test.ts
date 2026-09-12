import assert from "node:assert/strict";
import fs from "node:fs";
import * as vscode from "vscode";

/** Actual Extension Host API test against a synthetic localhost provider and an OS-backed key. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("pydemia.commit-defender");
  assert(extension);
  await extension.activate();
  const settings = vscode.workspace.getConfiguration("commitDefender");
  assert.equal(settings.inspect("apiKey")?.globalValue, undefined);
  assert.equal(settings.inspect("apiKey")?.workspaceValue, undefined);
  const reference = settings.inspect<{ profileId: string }>(
    "modelCredentialRef",
  )?.globalValue;
  assert.equal(reference?.profileId, process.env.CD_CREDENTIAL_PROFILE);
  const git = vscode.extensions.getExtension("vscode.git");
  assert(git);
  const api = (await git.activate()).getAPI(1);
  const deadline = Date.now() + 20_000;
  while (
    !api.repositories.some(
      (repo: { rootUri: vscode.Uri }) =>
        repo.rootUri.fsPath === process.env.CD_CREDENTIAL_WORKSPACE,
    )
  ) {
    if (Date.now() > deadline)
      throw Error("Synthetic Git repository was not discovered.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await vscode.commands.executeCommand("commitDefender.generateCommitMessage");
  const repository = api.repositories.find(
    (repo: { rootUri: vscode.Uri }) =>
      repo.rootUri.fsPath === process.env.CD_CREDENTIAL_WORKSPACE,
  );
  assert.equal(
    repository.inputBox.value,
    "test: verify shared model credential",
  );
  fs.writeFileSync(
    process.env.CD_CREDENTIAL_HOST_EVIDENCE!,
    JSON.stringify(
      {
        status: "passed",
        vscode: vscode.version,
        node: process.versions.node,
        extensionActivated: true,
        apiKeyAbsentFromSettings: true,
        generatedCommitMessageUsingOsCredential: true,
        provider: "synthetic localhost API",
        realModelCalls: 0,
        visualInspection: false,
      },
      null,
      2,
    ) + "\n",
  );
}
