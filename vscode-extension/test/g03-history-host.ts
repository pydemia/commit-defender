/** Explicit PRISM-DEV verification. Never runs in npm test or ships in VSIX. */
import * as vscode from "vscode";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { CentralConnections, contentHash } from "@gcr/client-core";
import { reviewHistoryDetail, reviewHistoryMessagePage } from "@gcr/client-contract";
import { knowledgeScope } from "../src/localKnowledge.js";
import { centralHistoryHtml } from "../src/centralHistoryView.js";
import { showAuthorizedCentralText } from "../src/centralKnowledgeView.js";
import { prepareStandaloneReview } from "../src/standaloneReview.js";
import { prepareStandaloneWorker } from "../src/standaloneWorkerClient.js";

export async function run() {
  const input = JSON.parse(
    fs.readFileSync(process.env.G03_CONFIGURATION!, "utf8"),
  );
  const workspace = process.env.G03_WORKSPACE!,
    profileId = process.env.G03_PROFILE!;
  const proofFile = process.env.G03_EVIDENCE!;
  const real = process.env.G03_MODEL_CONFIGURATION
    ? JSON.parse(fs.readFileSync(process.env.G03_MODEL_CONFIGURATION, "utf8"))
    : undefined;
  const sourceId = "4f94ce45-2f0e-42e5-98b4-6ed2c2fde3e1";
  const file =
    "data-management/mainapp/domains/position_management/block/schema.py";
  const proof: Record<string, any> = {
    status: "running",
    vscode: vscode.version,
    realCentralServer: true,
    realModel: Boolean(real),
    modelCalls: 0,
    syntheticResponse: !real,
    sourceFixture: "G03 BlockUpdateRequest",
    newCollection: 0,
  };
  const save = () =>
    fs.writeFileSync(proofFile, JSON.stringify(proof, null, 2) + "\n");
  const scope = knowledgeScope({
    repoRoot: workspace,
    profileId,
    scope: "repository",
  });
  const manager = await CentralConnections.open({
    scope,
    repositoryRoot: workspace,
  });
  let connectionId: string | undefined;
  const subscriptions: vscode.Disposable[] = [];
  try {
    const extension = vscode.extensions.getExtension(
      "pydemia.commit-defender",
    )!;
    await extension.activate();
    proof.extension = {
      version: extension.packageJSON.version,
      path: extension.extensionPath,
      active: extension.isActive,
    };
    const worker = path.join(
      extension.extensionPath,
      "out/standalone-review-worker.js",
    );
    proof.workerSha256 = createHash("sha256")
      .update(fs.readFileSync(worker))
      .digest("hex");
    const connection = await manager.connect(
      input.config,
      input.token,
      "commit-defender",
    );
    connectionId = connection.id;
    proof.connectionId = connectionId;
    proof.pulls = [];
    for (const pullNumber of [917, 915]) {
      const result = await manager.readHistory(connectionId, {
        kind: "pulls",
        pullNumber,
      });
      assert("items" in result.data && result.data.items.length === 1);
      proof.pulls.push({ number: pullNumber, revision: result.data.revision });
    }
    const original = await manager.readHistory(connectionId, {
      kind: "message",
      pullNumber: 917,
      sourceId,
    });
    const detail = reviewHistoryDetail(original.data);
    assert.equal(detail.item.githubId, "3967869279");
    const offline = await manager.readHistory(
      connectionId,
      { kind: "message", pullNumber: 917, sourceId },
      "offline",
    );
    assert(offline.cached);
    assert.deepEqual(offline.data, original.data);
    proof.original = {
      sourceId,
      contentHash: detail.item.contentHash,
      observationHash: detail.item.observationHash,
      url: detail.item.htmlUrl,
      offlineExact: true,
    };
    const reviewFreshness = real?.settings?.freshness === "offline" ? "offline" : "online";
    if (reviewFreshness === "offline") {
      await manager.readHistory(connectionId, {
        kind: "guidance-detail", guidanceId: "9ee94837-fd43-46f6-ac03-30bdfb8d3575",
      });
      const replies = reviewHistoryMessagePage((await manager.readHistory(connectionId, {
        kind: "messages", pullNumber: 917, parentId: sourceId,
      })).data);
      assert.equal(replies.nextCursor, null);
      for (const reply of replies.items) await manager.readHistory(connectionId, {
        kind: "message", pullNumber: 917, sourceId: reply.id,
      });
      proof.historyPrefetchedOnlineForSignedOfflineReview = true;
    }
    const panel = showAuthorizedCentralText(
      { subscriptions } as vscode.ExtensionContext,
      "G03 original PR review comment",
      centralHistoryHtml("PR #917 original comment", original),
      Date.parse(original.expiresAt),
      async () => {
        await (
          await manager.review(connectionId!, reviewFreshness)
        ).assertConnection();
      },
    );
    assert(panel.webview.html.includes(detail.item.contentHash));
    assert.equal(panel.webview.options.enableScripts, false);
    proof.nativeOriginalPanel = true;
    const settings = {
      mode: "centralized",
      connectionId,
      freshness: "online" as const,
      offlineBehavior: "pause" as const,
      profileId,
      provider: real?.provider ?? "codex",
      model: real?.model ?? "synthetic-model",
      reasoningEffort: real?.reasoningEffort ?? "high",
      executablePath: real?.executablePath ?? "/not-executed",
      workspaceTrusted: true,
      durationMs: 300000,
      excludePatterns: [],
      ...(real?.settings ?? {}),
    };
    const signal = AbortSignal.timeout(Math.max(600000, settings.durationMs + 60000));
    if (real) assert.equal(real.maximumReviewInvocations, 1);
    const job = real
      ? await prepareStandaloneWorker(
          worker,
          { repoRoot: workspace, files: [file], scope: "staged" },
          settings,
          signal,
        )
      : await prepareStandaloneReview(
          { repoRoot: workspace, files: [file], scope: "staged" },
          settings,
          signal,
          {
            prepareExecutor: async () => ({
              descriptor: {
                id: "synthetic-g03-host",
                version: "1",
                model: settings.model,
                configHash: contentHash("synthetic-g03-host"),
                capabilities: {
                  available: true,
                  sourceIsolation: "fixed-source-only",
                  timeout: true,
                  cancellation: true,
                  childProcessCleanup: true,
                  outputTokenLimit: false,
                },
              },
              async review(input) {
                assert(input.prompt.includes(sourceId));
                assert(input.prompt.includes(detail.item.htmlUrl));
                assert(
                  input.prompt.includes("9ee94837-fd43-46f6-ac03-30bdfb8d3575"),
                );
                const reads = [];
                for (const side of ["source", "base"])
                  reads.push(
                    JSON.parse(
                      await input.source.execute("read_file", {
                        path: file,
                        side,
                      }),
                    ),
                  );
                return {
                  model: settings.model,
                  raw: JSON.stringify({
                    summary:
                      "Synthetic response verifies native host context wiring only",
                    files: [
                      {
                        path: file,
                        side: "source",
                        complete: true,
                        summary: "Synthetic",
                        readIds: reads.map((r) => r.readId),
                      },
                    ],
                    findings: [],
                    questions: [],
                  }),
                };
              },
            }),
          },
        );
    try {
      proof.modelSelection = {
        provider: settings.provider,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
      };
      proof.modelCalls = real ? 1 : 0;
      save();
      const result = await job.run(signal);
      const report = result.report.gcr!.report;
      assert(!JSON.stringify(report).includes(input.token));
      proof.report = report;
      save();
      assert.equal(report.status, "completed");
      assert(
        report.identity.context.entries.some(
          (e) => e.id === "history-" + sourceId,
        ),
      );
      assert(
        report.evidence.some(
          (e) =>
            e.kind === "reasoning" &&
            e.provenance.reference === detail.item.htmlUrl,
        ),
      );
      assert.equal(report.identity.executor.model, settings.model);
    } finally {
      await job.dispose?.();
    }
    panel.dispose();
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.failure =
      error instanceof Error ? error.message : "Host verification failed";
    throw error;
  } finally {
    for (const disposable of subscriptions) disposable.dispose();
    if (connectionId) await manager.disconnect(connectionId);
    manager.close();
    save();
  }
}
