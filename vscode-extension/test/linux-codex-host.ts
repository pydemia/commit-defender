/** Explicit Linux acceptance only; one authenticated review, never npm test. */
import * as vscode from "vscode";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { discoverLocalIdentity, LocalHistoryStore, LocalRecordStore } from "@gcr/client-core";
import { prepareStandaloneWorker } from "../src/standaloneWorkerClient.js";

export async function run() {
  assert.equal(process.platform, "linux");
  const config = JSON.parse(fs.readFileSync(process.env.GCR_LINUX_CONFIGURATION!, "utf8"));
  assert.equal(config.maximumReviewInvocations, 1);
  assert.equal(config.model, "gpt-5.6-luna");
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.durationMs, 240000);
  const extension = vscode.extensions.getExtension("pydemia.commit-defender")!;
  assert(extension);
  const worker = path.join(extension.extensionPath, "out/standalone-review-worker.js");
  const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert.equal(hash(worker), config.workerSha256);
  const proof: Record<string, any> = {
    status: "preparing", platform: process.platform, arch: process.arch,
    node: process.version, vscode: vscode.version,
    extensionVersion: extension.packageJSON.version,
    extensionPath: extension.extensionPath, workerSha256: hash(worker),
    codeSha256: hash(process.execPath), codexSha256: hash(config.executablePath),
    realModel: false, syntheticResponse: false, centralConnection: false,
    modelCalls: 0, maximumReviewInvocations: 1, timeoutMs: 240000,
    accountSource: "existing WSL user Codex auth.json; private same-inode link",
    route: "Linux Extension Host -> packaged review worker -> isolated Codex",
    expectation: "completed report identifies subtraction in sum.ts and reopens encrypted history",
  };
  const save = () => fs.writeFileSync(process.env.GCR_LINUX_EVIDENCE!, JSON.stringify(proof, null, 2) + "\n");
  save();
  let job: Awaited<ReturnType<typeof prepareStandaloneWorker>> | undefined;
  try {
    await extension.activate();
    assert(vscode.workspace.isTrusted);
    job = await prepareStandaloneWorker(worker, {
      repoRoot: config.workspace, files: ["sum.ts"], scope: "staged",
    }, {
      mode: "standalone", profileId: config.profileId,
      provider: "codex", model: config.model,
      reasoningEffort: config.reasoningEffort, executablePath: config.executablePath,
      durationMs: config.durationMs, workspaceTrusted: true, excludePatterns: [],
    }, AbortSignal.timeout(120000));
    proof.status = "running";
    proof.modelCalls = 1;
    proof.realModel = true;
    proof.startedAt = new Date().toISOString();
    save();
    const result = await job.run(AbortSignal.timeout(240000));
    proof.finishedAt = new Date().toISOString();
    proof.report = result.report.gcr!.report;
    proof.reviewCompletionConfirmed = result.reviewCompletionConfirmed;
    save();
    assert.equal(proof.report.status, "completed");
    assert.equal(proof.report.identity.executor.model, "gpt-5.6-luna");
    assert.equal(proof.report.problems.length, 0);
    assert.equal(result.reviewCompletionConfirmed, true);
    assert(proof.report.findings.some((finding: any) =>
      finding.anchor.path === "sum.ts" && finding.anchor.startLine <= 2 &&
      finding.anchor.endLine >= 2));
    assert(!JSON.stringify(proof.report).includes("LINUX_EXCLUDED_SECRET"));
    const client = discoverLocalIdentity(config.workspace, config.profileId);
    const records = await LocalRecordStore.open({ scope: {
      kind: "repository", profileId: client.profileId,
      repositoryKey: client.repositoryKey, worktreeKey: client.worktreeKey,
    } });
    try {
      assert.deepEqual(await new LocalHistoryStore(records).getReview(proof.report.runId), proof.report);
      proof.encryptedHistoryReopened = true;
    } finally { records.close(); }
    await vscode.commands.executeCommand("commitDefender.showHistoryEntry", {
      report: result.report, repoRoot: config.workspace,
    });
    proof.savedResultCommandOpened = true;
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.failure = error instanceof Error ? error.message : "Host verification failed";
    throw error;
  } finally { await job?.dispose?.(); save(); }
}
