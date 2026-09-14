import * as vscode from "vscode";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { callLocalService, ServiceJobs } from "@gcr/client-core";

export async function run() {
  const root = process.env.CD_EDITOR_WORKSPACE!,
    profileId = process.env.CD_EDITOR_PROFILE!;
  const evidence = process.env.CD_EDITOR_EVIDENCE!,
    invocations = process.env.CD_EDITOR_INVOCATIONS!;
  const proof = JSON.parse(await readFile(evidence, "utf8"));
  const checkpoint = () =>
    writeFile(evidence, JSON.stringify(proof, null, 2) + "\n", { mode: 0o600 });
  const pause = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (check: () => Promise<boolean>) => {
    let nextLog = Date.now() + 30000;
    for (;;) {
      const status = (await callLocalService(
        { profileId },
        { action: "status" },
      )) as { jobs: Array<{ state: string; result?: { status: string } }> };
      assert(
        !status.jobs.some(
          (job) =>
            job.state === "interrupted" ||
            (job.state === "finished" && job.result?.status !== "completed"),
        ),
      );
      if (await check()) return;
      if (Date.now() > nextLog) {
        await checkpoint();
        console.log("Observing the same editor Save request.");
        nextLog = Date.now() + 30000;
      }
      await pause(200);
    }
  };
  const count = async () =>
    (await readFile(invocations, "utf8"))
      .split("\n")
      .filter((line) => line === "review-exec").length;
  const extension = vscode.extensions.getExtension("pydemia.commit-defender");
  assert(extension);
  await extension.activate();
  const location = { profileId };
  const registration = (await callLocalService(location, {
    action: "registration",
    root,
  })) as { key: string };
  assert(registration);
  const jobs = await ServiceJobs.open({
    scope: { kind: "profile", profileId },
  });
  try {
    proof.vscode = vscode.version;
    proof.runtime = process.version;
    assert.equal(
      (await jobs.watch(registration.key, "save"))?.editor?.sessions.length,
      1,
    );
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(root, "sum.ts")),
    );
    const editor = await vscode.window.showTextDocument(document);
    const setText = (text: string) =>
      editor.edit((edit) =>
        edit.replace(
          new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length),
          ),
          text,
        ),
      );
    await vscode.workspace
      .getConfiguration("files")
      .update("autoSaveDelay", 1000, vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration("files")
      .update("autoSave", "afterDelay", vscode.ConfigurationTarget.Global);
    await setText(
      "export const sum = (values: number[]) => values.reduce((a, b) => a + b);\n",
    );
    await until(
      async () =>
        !document.isDirty &&
        !!(await jobs.watch(registration.key, "save"))?.editor?.events.some(
          (event) => event.path === "sum.ts" && !event.allowed,
        ),
    );
    await pause(6000);
    assert.equal((await jobs.list()).length, 0);
    assert.equal(await count(), 0);
    proof.autoSaveSuppressed = true;
    await vscode.workspace
      .getConfiguration("files")
      .update("autoSave", "off", vscode.ConfigurationTarget.Global);
    await setText(
      "// Manual Save fixture\nexport const sum = (values: number[]) => values.reduce((a, b) => a + b);\n",
    );
    assert.equal(await document.save(), true);
    await until(async () => {
      const completed = (await jobs.list()).find(
        (job) => job.trigger === "save" && job.state === "finished",
      );
      if (!completed) return false;
      proof.uiReceiptId = completed.id;
      const diagnostics = vscode.languages
        .getDiagnostics(document.uri)
        .filter((item) => item.source?.startsWith("commit-defender"));
      if (!diagnostics.length) return false;
      proof.liveDiagnostics = diagnostics.length;
      return true;
    });
    await setText(
      "// Second manual Save before closing\nexport const sum = (values: number[]) => values.reduce((a, b) => a + b);\n",
    );
    await until(
      async () =>
        !vscode.languages
          .getDiagnostics(document.uri)
          .some((item) => item.source?.startsWith("commit-defender")),
    );
    proof.changedSourceClearedDiagnostics = true;
    assert.equal(await document.save(), true);
    await until(async () => {
      const rows = await jobs.list();
      const active = rows.find(
        (job) => job.trigger === "save" && job.state === "running",
      );
      if (!active || (await count()) !== 2) return false;
      proof.manualReceiptId = active.id;
      proof.manualRunningBeforeHostExit = true;
      return true;
    });
    proof.status = "host-ready-to-close";
    await checkpoint();
  } finally {
    jobs.close();
  }
}
