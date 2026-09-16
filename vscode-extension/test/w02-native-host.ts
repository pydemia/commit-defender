/** Windows central-storage preflight: synthetic HTTPS/model, zero account calls. */
import * as vscode from "vscode";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { CentralConnections, contentHash } from "@gcr/client-core";
import { centralFixture } from "./helpers/central-fixture.js";
import { knowledgeScope } from "../src/localKnowledge.js";
import { prepareStandaloneReview } from "../src/standaloneReview.js";
import { prepareStandaloneWorker } from "../src/standaloneWorkerClient.js";
import { readCentralHistory } from "../src/centralConnection.js";

export async function run() {
  assert.equal(process.platform, "win32");
  const input = JSON.parse(fs.readFileSync(process.env.W02_CONFIGURATION!, "utf8"));
  assert.equal(input.maximumReviewInvocations, 0);
  const extension = vscode.extensions.getExtension("pydemia.commit-defender")!;
  assert(extension);
  assert.deepEqual(fs.readFileSync(path.join(__dirname, "windows-native.exe")),
    fs.readFileSync(path.join(extension.extensionPath, "out/windows-native.exe")));
  await extension.activate();
  assert(vscode.workspace.isTrusted);
  const fixture = await centralFixture(path.dirname(input.workspace));
  const location = { repoRoot: input.workspace, profileId: input.profileId,
    scope: "repository" as const };
  const scope = knowledgeScope(location);
  let manager = await CentralConnections.open({ scope });
  let connectionId: string | undefined;
  let job: Awaited<ReturnType<typeof prepareStandaloneReview>> | undefined;
  const proof: Record<string, unknown> = {
    platform: process.platform, arch: process.arch, node: process.version,
    vscode: vscode.version, extensionVersion: extension.packageJSON.version,
    extensionPath: extension.extensionPath,
    workerSha256: createHash("sha256").update(fs.readFileSync(path.join(
      extension.extensionPath, "out/standalone-review-worker.js"))).digest("hex"),
    realCentralServer: false, syntheticHttps: true, syntheticResponse: true,
    realModel: false, modelCalls: 0, status: "running",
  };
  const save = () => fs.writeFileSync(process.env.W02_EVIDENCE!,
    JSON.stringify(proof, null, 2) + "\n");
  save();
  try {
    const start = Date.now();
    const connected = await manager.connect(fixture.config, fixture.secret, "commit-defender");
    connectionId = connected.id;
    proof.connectionDurationMs = Date.now() - start;
    manager.close();
    manager = await CentralConnections.open({ scope });
    const online = await (await manager.review(connectionId, "online")).cache.read("online");
    const offline = await (await manager.review(connectionId, "offline")).cache.read("offline");
    assert.deepEqual(online.manifest, offline.manifest);
    proof.reopenedConnectionAndSignedCache = true;
    job = await prepareStandaloneReview({
      repoRoot: input.workspace, files: ["sum.ts"], scope: "staged",
    }, {
      mode: "centralized", connectionId, freshness: "online", offlineBehavior: "pause",
      profileId: input.profileId, provider: "codex", model: "synthetic-w02",
      reasoningEffort: "high", executablePath: "/never-executed",
      workspaceTrusted: true, durationMs: 30000, excludePatterns: [],
    }, AbortSignal.timeout(60000), {
      prepareExecutor: async () => ({
        descriptor: {
          id: "w02-synthetic", version: "1", model: "synthetic-w02",
          configHash: contentHash("w02-synthetic"),
          capabilities: { available: true, sourceIsolation: "fixed-source-only",
            cancellation: true, timeout: true, childProcessCleanup: true,
            outputTokenLimit: false },
        },
        async review(request) {
          assert(request.prompt.includes("CD_CENTRAL_POLICY"));
          const reads = [];
          for (const side of ["source", "base"])
            reads.push(JSON.parse(await request.source.execute("read_file", {
              path: "sum.ts", side,
            })));
          return { model: "synthetic-w02", raw: JSON.stringify({
            summary: "Synthetic Windows central storage preflight",
            files: [{ path: "sum.ts", side: "source", complete: true,
              summary: "Synthetic response", readIds: reads.map((read) => read.readId) }],
            findings: [], questions: [],
          }) };
        },
      }),
    });
    const result = await job.run(AbortSignal.timeout(60000));
    const report = result.report.gcr!.report;
    assert.equal(report.status, "completed");
    assert.equal(result.reviewCompletionConfirmed, true);
    const history = await readCentralHistory(location, {
      version: 1, mode: "centralized", connectionId, freshness: "online",
    });
    assert.deepEqual(history.reports.find((entry) => entry.runId === report.runId), report);
    await vscode.commands.executeCommand("commitDefender.showHistoryEntry", {
      report: result.report, repoRoot: input.workspace,
    });
    proof.encryptedHistoryReopened = true;
    proof.savedResultCommandOpened = true;
    proof.syntheticReportStatus = report.status;
    const installed = await prepareStandaloneWorker(path.join(
      extension.extensionPath, "out/standalone-review-worker.js"), {
      repoRoot: input.workspace, files: ["sum.ts"], scope: "staged",
    }, {
      mode: "centralized", connectionId, freshness: "online", offlineBehavior: "pause",
      profileId: input.profileId, provider: "codex", model: "gpt-5.6-luna",
      reasoningEffort: "high", executablePath: input.executablePath,
      workspaceTrusted: true, durationMs: 240000, excludePatterns: [],
    }, AbortSignal.timeout(90000));
    await installed.dispose?.();
    proof.installedWorkerPreparation = "passed; disposed without model invocation";
    fixture.setStatus(403);
    await assert.rejects(manager.synchronize(connectionId), { code: "revoked" });
    await assert.rejects(manager.review(connectionId, "offline"));
    proof.syntheticRevocationBlocksOffline = true;
    assert(fixture.requestMethods.every((method) => method === "GET"));
    proof.syntheticCentralRequests = {
      count: fixture.requestMethods.length, methods: [...new Set(fixture.requestMethods)],
    };
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.failure = error instanceof Error ? error.message : "Native preflight failed";
    throw error;
  } finally {
    await job?.dispose?.();
    try {
      if (connectionId) await manager.disconnect(connectionId);
      proof.temporaryReaderCredentialRemoved = true;
    } finally { manager.close(); await fixture.close(); save(); }
  }
}
