/** Explicit Windows local-publisher acceptance; one account review per Host. */
import * as vscode from "vscode";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { CentralConnections } from "@gcr/client-core";
import { reviewHistoryDetail, reviewHistoryMessagePage } from "@gcr/client-contract";
import { centralFixture } from "./helpers/central-fixture.js";
import { w02HistoryFixture } from "./helpers/w02-history-fixture.js";
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
  const fixtureHistory = w02HistoryFixture(input.records);
  const fixture = await centralFixture(path.dirname(input.workspace),
    "Inspect source, base, callers, dependency declarations and boundary tests. " +
    "Explain whether each historical guideline applies, is already satisfied, " +
    "or is excluded by counter-evidence. Cite its ID, revision and source URL. " +
    "Historical bodies here are explicitly local reconstructions, not originals. " +
    "Reading tests does not execute them. Report only current concrete defects.",
    false, fixtureHistory);
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
    realCentralServer: false, localHttpsPublisher: true,
    reconstructedHistory: true, syntheticResponse: false, realModel: false,
    modelCalls: 0, case: input.case, status: "running",
    fixtureBaseSha: input.fixtureBaseSha, fixtureTreeSha: input.fixtureTreeSha,
    boundaryTests: "fixed source only; not executed",
    modelSelection: { provider: "codex", model: "gpt-5.6-luna", reasoningEffort: "high" },
  };
  const save = () => fs.writeFileSync(process.env.W02_EVIDENCE!,
    JSON.stringify(proof, null, 2) + "\n");
  save();
  try {
    const connection = await manager.connect(fixture.config, fixture.secret, "commit-defender");
    connectionId = connection.id;
    manager.close();
    manager = await CentralConnections.open({ scope });
    const requests: any[] = [
      { kind: "pulls", pullNumber: 917 }, { kind: "pulls", pullNumber: 915 },
      { kind: "messages", pullNumber: 917 }, { kind: "messages", pullNumber: 915 },
      { kind: "message", pullNumber: 917, sourceId: fixtureHistory.source.id },
      { kind: "messages", pullNumber: 917, parentId: fixtureHistory.source.id },
      { kind: "message", pullNumber: 917, sourceId: fixtureHistory.reply.id },
      { kind: "versions", pullNumber: 917, sourceId: fixtureHistory.source.id },
      { kind: "observations", pullNumber: 917, sourceId: fixtureHistory.source.id },
      { kind: "guidance", sourceId: fixtureHistory.source.id },
      { kind: "guidance-detail", guidanceId: fixtureHistory.guidance.id },
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
    const original = await manager.readHistory(connectionId, requests[4], "offline");
    const detail = reviewHistoryDetail(original.data);
    assert.deepEqual(detail.item, fixtureHistory.source);
    const replies = reviewHistoryMessagePage((await manager.readHistory(
      connectionId, requests[5], "offline")).data);
    assert.equal(replies.items[0].id, fixtureHistory.reply.id);
    proof.sourceParity = { sourceId: detail.item.id, url: detail.item.htmlUrl,
      localContentHash: detail.item.contentHash,
      historicalContentHash: fixtureHistory.historicalHash,
      originalBodyUnavailable: true, reconstructedBodyHashIsDistinct: true,
      guidanceId: fixtureHistory.guidance.id, revision: fixtureHistory.guidance.revision };
    const panel = showAuthorizedCentralText({ subscriptions } as vscode.ExtensionContext,
      "W02 local reconstruction", centralHistoryHtml("Local source", original),
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
    const before = fixture.calls;
    proof.modelCalls = 1;
    proof.realModel = true;
    proof.startedAt = new Date().toISOString();
    save();
    const result = await job.run(AbortSignal.timeout(240000));
    proof.finishedAt = new Date().toISOString();
    proof.centralRequestsDuringModel = fixture.calls - before;
    const report = result.report.gcr!.report;
    proof.report = report;
    proof.reviewCompletionConfirmed = result.reviewCompletionConfirmed;
    save();
    assert.equal(report.status, "completed");
    assert.equal(result.reviewCompletionConfirmed, true);
    assert.equal(report.identity.executor.model, "gpt-5.6-luna");
    assert(report.identity.context.entries.some(e => e.id === fixtureHistory.guidance.id));
    assert(report.identity.context.entries.some(e => e.id === "history-" + detail.item.id));
    assert(report.evidence.some(e => e.kind === "reasoning" &&
      e.provenance.reference === detail.item.htmlUrl));
    assert(!JSON.stringify(report).includes("W02_EXCLUDED_SECRET"));
    assert(!JSON.stringify(report).includes(fixture.secret));
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
    proof.centralRequests = fixture.requestMetadata;
    proof.centralReadOnly = fixture.requestMetadata.every(request =>
      request.method === "GET" && request.bodyBytes === 0);
    try {
      if (connectionId) await manager.disconnect(connectionId);
      proof.temporaryReaderCredentialRemoved = true;
    } finally { manager.close(); await fixture.close(); save(); }
  }
}
