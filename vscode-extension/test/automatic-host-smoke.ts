/** Explicit real-account Save/Stage check in an isolated native VS Code profile. */
import * as vscode from "vscode";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  LocalRecordStore,
  LocalHistoryStore,
  ReviewRequests,
  discoverLocalIdentity,
} from "@gcr/client-core";
import type { ClientReviewReport } from "@gcr/client-contract";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function run() {
  const root = process.env.CD_AUTO_WORKSPACE!,
    profileId = process.env.CD_AUTO_PROFILE!,
    evidence = process.env.CD_AUTO_EVIDENCE!;
  assert(root && profileId && evidence);
  const extension = vscode.extensions.getExtension("pydemia.commit-defender");
  assert(extension);
  await extension.activate();
  const identity = discoverLocalIdentity(root, profileId);
  const scope = {
    kind: "repository" as const,
    profileId,
    repositoryKey: identity.repositoryKey,
    worktreeKey: identity.worktreeKey,
  };
  const proof: Record<string, unknown> = {
    status: "running",
    vscode: vscode.version,
    runtime: process.version,
    model: "gpt-6-astra",
    reasoningEffort: "xhigh",
    events: [],
  };
  const checkpoint = () =>
    writeFileSync(evidence, JSON.stringify(proof, null, 2) + "\n", {
      mode: 0o600,
    });
  checkpoint();
  const history = async () => {
    const records = await LocalRecordStore.open({ scope });
    try {
      return await new LocalHistoryStore(records).listReviews();
    } finally {
      records.close();
    }
  };
  const waitFor = async (
    trigger: "save" | "stage",
  ): Promise<ClientReviewReport> => {
    const end = Date.now() + 210000;
    while (Date.now() < end) {
      const entry = (await history()).find((r) => r.trigger === trigger);
      if (entry) {
        const records = await LocalRecordStore.open({ scope });
        try {
          const report = await new LocalHistoryStore(records).getReview(
            entry.runId,
          );
          assert(report);
          return report;
        } finally {
          records.close();
        }
      }
      await pause(500);
    }
    throw Error(
      `Automatic ${trigger} did not produce a terminal report within its verification limit`,
    );
  };
  const cfg = vscode.workspace.getConfiguration("commitDefender");
  try {
    await cfg.update("runOnSave", true, vscode.ConfigurationTarget.Global);
    await pause(2000);
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(root, "sum.ts")),
    );
    const editor = await vscode.window.showTextDocument(doc);
    const defect =
      "export const sum = (values: number[]) => values.reduce((a, b) => a + b);\n";
    await editor.edit((edit) =>
      edit.replace(
        new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length),
        ),
        defect,
      ),
    );
    const webviewsBefore = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => t.input instanceof vscode.TabInputWebview).length;
    assert.equal(await doc.save(), true);
    const saved = await waitFor("save");
    (proof.events as unknown[]).push({ trigger: "save", report: saved });
    checkpoint();
    assert.equal(saved.status, "completed");
    assert.equal(saved.identity.source.kind, "working-tree");
    assert(saved.findings.length > 0);
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.toString(),
      doc.uri.toString(),
    );
    assert.equal(
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .filter((t) => t.input instanceof vscode.TabInputWebview).length,
      webviewsBefore,
    );
    await cfg.update("runOnSave", false, vscode.ConfigurationTarget.Global);
    await cfg.update("runOnStage", true, vscode.ConfigurationTarget.Global);
    await pause(2000);
    execFileSync(
      "git",
      ["-C", root, "-c", "core.hooksPath=/dev/null", "add", "sum.ts"],
      { stdio: "pipe" },
    );
    const staged = await waitFor("stage");
    (proof.events as unknown[]).push({ trigger: "stage", report: staged });
    checkpoint();
    assert.equal(staged.status, "completed");
    assert.equal(staged.identity.source.kind, "index");
    assert(staged.findings.length > 0);
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.toString(),
      doc.uri.toString(),
    );
    assert.equal(
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .filter((t) => t.input instanceof vscode.TabInputWebview).length,
      webviewsBefore,
    );
    await vscode.commands.executeCommand("commitDefender.analyze");
    assert.equal((await history()).length, 2);
    const requests = await ReviewRequests.open({ scope });
    try {
      const rows = await requests.list();
      assert.equal(rows.length, 2);
      assert(rows.every((r) => r.generation === 1 && r.state === "finished"));
      assert(
        rows.some(
          (r) => r.reasons.includes("stage") && r.reasons.includes("manual"),
        ),
      );
      proof.requests = rows.map((r) => ({
        state: r.state,
        generation: r.generation,
        reasons: r.reasons,
        resultId: r.resultId,
      }));
    } finally {
      requests.close();
    }
    proof.status = "verified";
    proof.modelReviewInvocations = 2;
    proof.manualReusedStage = true;
    proof.automaticSummaryDidNotStealFocus = true;
  } catch (error) {
    proof.status = "failed";
    proof.failure =
      error instanceof Error ? error.message : "Verification failed";
    throw error;
  } finally {
    await cfg.update("runOnSave", false, vscode.ConfigurationTarget.Global);
    await cfg.update("runOnStage", false, vscode.ConfigurationTarget.Global);
    checkpoint();
  }
}
