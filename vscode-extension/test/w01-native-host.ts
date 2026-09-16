/** Explicit Windows acceptance; a single actual account review, never npm test. */
import * as vscode from "vscode";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { discoverLocalIdentity, LocalHistoryStore, LocalRecordStore } from "@gcr/client-core";
import { prepareStandaloneWorker } from "../src/standaloneWorkerClient.js";

export async function run() {
  assert.equal(process.platform, "win32");
  const configuration = JSON.parse(fs.readFileSync(process.env.W01_CONFIGURATION!, "utf8"));
  assert.equal(configuration.maximumReviewInvocations, 1);
  assert.equal(configuration.model, "gpt-5.6-luna");
  assert.equal(configuration.reasoningEffort, "high");
  assert.equal(configuration.durationMs, 240000);
  const extension = vscode.extensions.getExtension("pydemia.commit-defender")!;
  assert(extension);
  const worker = path.join(extension.extensionPath, "out/standalone-review-worker.js");
  const proof: Record<string, any> = {
    platform: process.platform, arch: process.arch, node: process.version,
    vscode: vscode.version, extensionVersion: extension.packageJSON.version,
    extensionPath: extension.extensionPath,
    workerSha256: createHash("sha256").update(fs.readFileSync(worker)).digest("hex"),
    realModel: true, syntheticResponse: false, centralConnection: false,
    maximumReviewInvocations: 1, timeoutMs: 240000, modelCalls: 0,
    accountSource: "existing default local Codex auth.json; NTFS auth-only link",
    fixture: "sum changes addition to subtraction with consumer and tests",
    expected: "completed review identifies incorrect negative totals in sum.ts",
    status: "preparing",
  };
  const save = () => fs.writeFileSync(process.env.W01_EVIDENCE!, JSON.stringify(proof, null, 2) + "\n");
  save();
  let job: Awaited<ReturnType<typeof prepareStandaloneWorker>> | undefined;
  try {
    await extension.activate();
    assert(vscode.workspace.isTrusted);
    const preparation = AbortSignal.timeout(120000);
    job = await prepareStandaloneWorker(worker, {
      repoRoot: configuration.workspace, files: ["sum.ts"], scope: "staged",
    }, {
      mode: "standalone", profileId: configuration.profileId,
      provider: "codex", model: configuration.model,
      reasoningEffort: configuration.reasoningEffort,
      executablePath: configuration.executablePath,
      durationMs: configuration.durationMs, workspaceTrusted: true,
      excludePatterns: [],
    }, preparation);
    proof.status = "running";
    proof.modelCalls = 1;
    proof.startedAt = new Date().toISOString();
    save();
    const result = await job.run(AbortSignal.timeout(240000));
    proof.finishedAt = new Date().toISOString();
    proof.report = result.report.gcr!.report;
    proof.reviewCompletionConfirmed = result.reviewCompletionConfirmed;
    save();
    assert.equal(proof.report.status, "completed");
    assert.equal(proof.report.identity.executor.model, "gpt-5.6-luna");
    assert.equal(result.reviewCompletionConfirmed, true);
    assert(proof.report.findings.some((finding: { anchor: {
      path: string; startLine: number; endLine: number } }) =>
      finding.anchor.path === "sum.ts" && finding.anchor.startLine <= 2 &&
      finding.anchor.endLine >= 2));
    assert(!JSON.stringify(proof.report).includes("W01_EXCLUDED_SECRET"));
    const client = discoverLocalIdentity(configuration.workspace, configuration.profileId);
    const records = await LocalRecordStore.open({ scope: {
      kind: "repository", profileId: client.profileId,
      repositoryKey: client.repositoryKey, worktreeKey: client.worktreeKey,
    } });
    try {
      const restored = await new LocalHistoryStore(records).getReview(proof.report.runId);
      assert.deepEqual(restored, proof.report);
      proof.encryptedHistoryReopened = true;
    } finally { records.close(); }
    await vscode.commands.executeCommand("commitDefender.showHistoryEntry", {
      report: result.report, repoRoot: configuration.workspace,
    });
    proof.savedResultCommandOpened = true;
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.failure = error instanceof Error ? error.message : "Host verification failed";
    throw error;
  } finally { await job?.dispose?.(); save(); }
}
