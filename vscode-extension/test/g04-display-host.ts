/** Display saved real results in the installed Extension Host without another model call. */
import * as vscode from "vscode";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { clientReviewReport, projectCommitDefender } from "@gcr/client-contract";
import { SummaryView } from "../src/summaryView.js";
import { ReviewLinks } from "../src/reviewLinks.js";

export async function run() {
  const extension = vscode.extensions.getExtension("pydemia.commit-defender")!;
  await extension.activate();
  const proof = { installedVersion: extension.packageJSON.version, installedPath: extension.extensionPath,
    modelCalls: 0, realExtensionHost: true, results: [] as unknown[] };
  assert.equal(proof.installedVersion, "2.11.3");
  for (const file of JSON.parse(process.env.G04_DISPLAY_REPORTS!) as string[]) {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    const core = clientReviewReport(saved.report);
    assert.equal(core.status, "completed");
    const report = projectCommitDefender(core);
    const view = new SummaryView(report, process.env.G03_WORKSPACE!, new ReviewLinks());
    assert(view.html.includes("4f94ce45-2f0e-42e5-98b4-6ed2c2fde3e1"));
    assert(view.html.includes("https://github.com/skccmygit/skax-successionX-backend/pull/917#discussion_r3967869279"));
    assert(view.html.includes(core.identity.context.hash));
    assert(view.html.includes("revision 1"));
    assert(view.html.replace(/<[^>]*>/g, "").includes(core.summary.replace(/[`*]/g, "").slice(0, 12)));
    await vscode.commands.executeCommand("commitDefender.showHistoryEntry", {
      id: core.runId, timestamp: new Date(core.finishedAt!), report,
      repoRoot: process.env.G03_WORKSPACE!, label: saved.sourceFixture, scope: "staged",
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs)
      .find(tab => tab.label === "Commit Defender — Summary" && tab.input instanceof vscode.TabInputWebview);
    assert(tab, "Installed extension summary tab did not open");
    const workerHash = createHash("sha256").update(fs.readFileSync(path.join(extension.extensionPath, "out/standalone-review-worker.js"))).digest("hex");
    assert.equal(workerHash, saved.workerSha256);
    proof.results.push({ input: path.basename(file), runId: core.runId, modelStatus: core.status,
      workerMatchesActualRun: true, installedSummaryCommandOpenedNativeTab: true,
      sameSourceRendererContainsSummarySourceAndVersion: true,
      rendererHtmlSha256: createHash("sha256").update(view.html).digest("hex"),
      limitation: "Native tab creation observed; HTML assertions use the identical source renderer, not a DOM screenshot." });
  }
  fs.writeFileSync(process.env.G03_EVIDENCE!, JSON.stringify(proof, null, 2)+"\n");
}
