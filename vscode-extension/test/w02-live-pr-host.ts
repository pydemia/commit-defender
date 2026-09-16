/** Actual GitHub original / Windows GCR reader acceptance; one account review per Host. */
import * as vscode from "vscode";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { CentralConnections, PlatformCentralCredentialStore } from "@gcr/client-core";
import {
  canonicalKnowledgeJson, reviewHistoryDetail, reviewHistoryGuidance,
  reviewHistoryMessagePage, reviewHistoryVersionPage,
  type ReviewHistoryRequest,
} from "@gcr/client-contract";
import { knowledgeScope } from "../src/localKnowledge.js";
import { prepareStandaloneWorker } from "../src/standaloneWorkerClient.js";
import { readCentralHistory } from "../src/centralConnection.js";
import { centralHistoryHtml } from "../src/centralHistoryView.js";
import { showAuthorizedCentralText } from "../src/centralKnowledgeView.js";

export async function run() {
  assert.equal(process.platform, "win32");
  const input = JSON.parse(fs.readFileSync(process.env.W02_CONFIGURATION!, "utf8"));
  assert.equal(input.maximumReviewInvocations, 1);
  assert(["defect", "fixed", "unrelated"].includes(input.case));
  const extension = vscode.extensions.getExtension("pydemia.commit-defender")!;
  await extension.activate();
  assert(vscode.workspace.isTrusted);
  const worker = path.join(extension.extensionPath, "out/standalone-review-worker.js");
  const live = JSON.parse(fs.readFileSync(input.liveConnection, "utf8"));
  assert.equal(new URL(live.config.serverUrl).hostname, "127.0.0.1");
  assert.equal(live.pullNumber, 3);
  assert(live.source && live.reply && live.guidance);
  const secret = await new PlatformCentralCredentialStore().read(live.credentialReference);
  assert(secret, "Task reader credential must be available in Windows secure storage");
  const location = { repoRoot: input.workspace, profileId: input.profileId,
    scope: "repository" as const };
  const scope = knowledgeScope(location);
  let manager = await CentralConnections.open({ scope });
  let connectionId: string | undefined;
  let job: Awaited<ReturnType<typeof prepareStandaloneWorker>> | undefined;
  const subscriptions: vscode.Disposable[] = [];
  const proof: Record<string, any> = {
    platform: process.platform, arch: process.arch, node: process.version,
    vscode: vscode.version, extensionVersion: extension.packageJSON.version,
    extensionPath: extension.extensionPath,
    workerSha256: createHash("sha256").update(fs.readFileSync(worker)).digest("hex"),
    hostHarnessSha256: createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"),
    realCentralServer: true, localHttpsPublisher: true, realGitHubOriginals: true,
    reconstructedHistory: false, syntheticResponse: false, realModel: false,
    modelCalls: 0, case: input.case, status: "running",
    fixtureBaseSha: input.fixtureBaseSha, fixtureTreeSha: input.fixtureTreeSha,
    fixedContext: input.fixedContext, githubHeadSha: live.githubHeadSha,
    boundaryTests: "fixed source only; not executed",
    modelSelection: { provider: "codex", model: "gpt-5.6-luna", reasoningEffort: "high" },
  };
  const save = () => fs.writeFileSync(process.env.W02_EVIDENCE!,
    JSON.stringify(proof, null, 2) + "\n");
  save();
  try {
    const connection = await manager.connect(live.config, secret, "commit-defender");
    connectionId = connection.id;
    manager.close();
    manager = await CentralConnections.open({ scope });
    const requests: ReviewHistoryRequest[] = [
      { kind: "pulls", pullNumber: 3 },
      { kind: "messages", pullNumber: 3 },
      { kind: "message", pullNumber: 3, sourceId: live.source.id },
      { kind: "messages", pullNumber: 3, parentId: live.source.id },
      { kind: "message", pullNumber: 3, sourceId: live.reply.id },
      { kind: "versions", pullNumber: 3, sourceId: live.source.id },
      { kind: "observations", pullNumber: 3, sourceId: live.source.id },
      { kind: "guidance", sourceId: live.source.id },
      { kind: "guidance-detail", guidanceId: live.guidance.id },
    ];
    proof.readerParity = [];
    for (const request of requests) {
      const online = await manager.readHistory(connectionId, request);
      const offline = await manager.readHistory(connectionId, request, "offline");
      assert.deepEqual(online.data, offline.data);
      assert(offline.cached);
      proof.readerParity.push({ request, exactOffline: true,
        revision: online.data.revision,
        count: "items" in online.data ? online.data.items.length : undefined });
    }
    const original = await manager.readHistory(connectionId, requests[2], "offline");
    const detail = reviewHistoryDetail(original.data);
    assert.equal(detail.item.id, live.source.id);
    assert.equal(detail.item.contentHash, live.source.contentHash);
    assert.equal(detail.item.htmlUrl, live.source.url);
    assert.equal(createHash("sha256").update(detail.item.body).digest("hex"), live.source.contentHash);
    const replies = reviewHistoryMessagePage((await manager.readHistory(
      connectionId, requests[3], "offline")).data);
    assert.equal(replies.items[0].id, live.reply.id);
    const replyDetail = reviewHistoryDetail((await manager.readHistory(
      connectionId, requests[4], "offline")).data);
    assert.equal(replyDetail.item.contentHash, live.reply.contentHash);
    assert.equal(createHash("sha256").update(replyDetail.item.body).digest("hex"), live.reply.contentHash);
    const versions = reviewHistoryVersionPage((await manager.readHistory(
      connectionId, requests[5], "offline")).data);
    assert(versions.items.length >= 2, "Collect original and edited body versions");
    assert.deepEqual(versions.items.map(item => item.contentHash),
      live.bodyVersions.map((item: { contentHash: string }) => item.contentHash));
    proof.bodyVersions = versions.items.map(item => ({ id: item.id, contentHash: item.contentHash }));
    const guidance = reviewHistoryGuidance((await manager.readHistory(
      connectionId, requests[8], "offline")).data);
    assert.equal(guidance.id, live.guidance.id);
    assert.equal(guidance.revision, live.guidance.revision);
    assert.equal(guidance.state, "active");
    assert.equal(guidance.needsReview, false);
    assert.equal(guidance.source.contentHash, live.source.contentHash);
    assert.equal(createHash("sha256").update(canonicalKnowledgeJson(guidance.content))
      .digest("hex"), live.guidance.contentSha256);
    proof.sourceParity = { sourceId: detail.item.id, url: detail.item.htmlUrl,
      contentHash: detail.item.contentHash, observationHash: detail.item.observationHash,
      githubOriginalBodyVerified: true, replyBodyVerified: true,
      guidanceId: live.guidance.id, revision: live.guidance.revision };
    const panel = showAuthorizedCentralText({ subscriptions } as vscode.ExtensionContext,
      "W02 actual GitHub source", centralHistoryHtml("Local source", original),
      Date.parse(original.expiresAt), async () => {
        await (await manager.review(connectionId!, "offline")).assertConnection();
      });
    assert(panel.webview.html.includes(detail.item.contentHash));
    proof.sourcePanel = true;
    const pinned = await (await manager.review(connectionId, "offline")).cache.read("offline");
    proof.manifest = pinned.manifest;
    assert(Date.parse(pinned.manifest.payload.refreshAfter) -
      Date.parse(pinned.manifest.payload.issuedAt) <= 300000);
    assert(Date.parse(pinned.manifest.payload.offlineValidUntil) - Date.now() > 300000);
    const settings = {
      mode: "centralized", connectionId, freshness: "offline" as const,
      offlineBehavior: "pause" as const, profileId: input.profileId,
      provider: "codex", model: "gpt-5.6-luna", reasoningEffort: "high",
      executablePath: input.executablePath, workspaceTrusted: true,
      durationMs: 240000, excludePatterns: [],
      w02Worker: worker, w02Events: input.cliEvents,
    };
    save();
    job = await prepareStandaloneWorker(path.resolve(__dirname,
      "../test/w02-observed-worker.cjs"), {
      repoRoot: input.workspace, files: [input.target], scope: "staged",
    }, settings, AbortSignal.timeout(90000));
    proof.modelCalls = 1;
    proof.realModel = true;
    proof.startedAt = new Date().toISOString();
    save();
    const result = await job.run(AbortSignal.timeout(240000));
    proof.finishedAt = new Date().toISOString();
    proof.centralRequestsDuringModel = "cross-check server request timestamps after Host exit";
    const report = result.report.gcr!.report;
    proof.report = report;
    proof.reviewCompletionConfirmed = result.reviewCompletionConfirmed;
    save();
    assert.equal(report.status, "completed");
    assert.equal(result.reviewCompletionConfirmed, true);
    assert.equal(report.identity.executor.model, "gpt-5.6-luna");
    assert(report.identity.context.entries.some(e => e.id === live.guidance.id));
    assert(report.identity.context.entries.some(e => e.id === "history-" + detail.item.id));
    assert(report.evidence.some(e => e.kind === "reasoning" &&
      e.provenance.reference === detail.item.htmlUrl));
    assert(!JSON.stringify(report).includes("W02_EXCLUDED_SECRET"));
    assert(!JSON.stringify(report).includes(secret));
    proof.contextMetadataMatched = true;
    proof.modelJudgment = "pending manual assessment of response, separate from context metadata";
    const history = await readCentralHistory(location, {
      version: 1, mode: "centralized", connectionId, freshness: "offline",
    });
    assert.deepEqual(history.reports.find(entry => entry.runId === report.runId), report);
    proof.encryptedHistoryReopened = true;
    await vscode.commands.executeCommand("commitDefender.showHistoryEntry", {
      report: result.report, repoRoot: input.workspace,
    });
    proof.savedResultCommandOpened = true;
    panel.dispose();
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.failure = error instanceof Error ? error.message : "Local Host verification failed";
    throw error;
  } finally {
    await job?.dispose?.();
    for (const item of subscriptions) item.dispose();
    proof.centralReadOnly = "verify against actual GCR server request log";
    try {
      if (connectionId) await manager.disconnect(connectionId);
      proof.temporaryReaderCredentialRemoved = true;
    } finally { manager.close(); save(); }
  }
}
