import * as vscode from "vscode";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { contentHash, CentralConnections } from "@gcr/client-core";
import { projectCommitDefender } from "@gcr/client-contract";
import { readCentralHistory } from "../src/centralConnection.js";
import { knowledgeScope } from "../src/localKnowledge.js";
import { prepareStandaloneReview } from "../src/standaloneReview.js";
async function until(read: () => Promise<boolean>) {
  const deadline = Date.now() + 180000;
  while (!(await read())) {
    if (Date.now() > deadline)
      throw Error("Submission host observation expired");
    await new Promise((r) => setTimeout(r, 250));
  }
}
export async function run() {
  const workspace = process.env.CD_SUBMISSION_WORKSPACE!,
    profileId = process.env.CD_SUBMISSION_PROFILE!;
  const evidence = process.env.CD_SUBMISSION_EVIDENCE!,
    control = process.env.CD_SUBMISSION_CONTROL!;
  const proof: Record<string, unknown> = {
    status: "running",
    vscode: vscode.version,
    syntheticInitialReview: true,
    actualFollowupReview: false,
    externalModelCalls: 0,
  };
  const save = () => writeFileSync(evidence, JSON.stringify(proof, null, 2));
  const controls = () => {
    try {
      return JSON.parse(readFileSync(control, "utf8"));
    } catch {
      return {};
    }
  };
  const scope = knowledgeScope({
    repoRoot: workspace,
    profileId,
    scope: "repository",
  });
  const input = JSON.parse(
    readFileSync(process.env.CD_FOLLOWUP_CONFIGURATION!, "utf8"),
  );
  const central = { config: input.config, secret: input.token };
  const connections = await CentralConnections.open({ scope });
  let connectionId: string | undefined;
  try {
    const extension = vscode.extensions.getExtension(
      "pydemia.commit-defender",
    )!;
    await extension.activate();
    const connection = await connections.connect(
      central.config,
      central.secret,
      "commit-defender",
    );
    connectionId = connection.id;
    proof.connectionId = connection.id;
    const job = await prepareStandaloneReview(
      { repoRoot: workspace, files: ["cache.py"], scope: "staged" },
      {
        mode: "standalone",
        profileId,
        provider: "codex",
        model: "gpt-6-astra",
        reasoningEffort: "xhigh",
        executablePath: "/unused",
        workspaceTrusted: true,
        durationMs: 30000,
        excludePatterns: [],
      },
      new AbortController().signal,
      {
        prepareExecutor: async () => ({
          descriptor: {
            id: "fixture",
            version: "1",
            model: "gpt-6-astra",
            configHash: contentHash("submission-native-host"),
            capabilities: {
              available: true,
              sourceIsolation: "fixed-source-only",
              cancellation: true,
              timeout: true,
              childProcessCleanup: true,
              outputTokenLimit: false,
            },
          },
          async review(input) {
            const reads = [];
            for (const side of ["source", "base"])
              reads.push(
                JSON.parse(
                  await input.source.execute("read_file", {
                    path: "cache.py",
                    side,
                  }),
                ),
              );
            return {
              model: "gpt-6-astra",
              raw: JSON.stringify({
                summary: "PRIVATE_NATIVE_REVIEW_PROSE",
                files: [
                  {
                    path: "cache.py",
                    side: "source",
                    complete: true,
                    summary: "Private summary",
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
    const report = (await job.run(new AbortController().signal)).report.gcr!
      .report;
    assert.equal(report.status, "completed");
    proof.stage = "select-connection";
    save();
    await vscode.commands.executeCommand(
      "commitDefender.manageCentralConnection",
    );
    const open = () =>
      vscode.commands.executeCommand("commitDefender.submitReviewFeedback", {
        report: projectCommitDefender(report),
        repoRoot: workspace,
      });
    await open();
    proof.stage = "panel-open";
    save();
    await until(async () => controls().review === true);
    const expected = controls();
    proof.stage = "review-requested";
    proof.externalModelCalls = null;
    save();
    const deadline = Date.now() + 720000;
    let result;
    while (Date.now() < deadline) {
      const history = await readCentralHistory(
        { repoRoot: workspace, profileId, scope: "repository" },
        { version: 1, mode: "centralized", connectionId, freshness: "online" },
      );
      result = history.reports.find((r) => r.runId !== report.runId);
      if (result) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert(
      result,
      "No terminal central review report was saved before the observation deadline",
    );
    writeFileSync(
      evidence.replace(/\.json$/, "-report.json"),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    proof.reviewStatus = result.status;
    proof.runId = result.runId;
    proof.stage = "review-terminal";
    save();
    assert.equal(result.status, "completed", JSON.stringify(result.problems));
    assert.equal(
      result.identity.context.centralSnapshot?.id,
      expected.snapshotId,
    );
    assert(
      result.identity.context.entries.some((e) => e.id === expected.ruleId),
    );
    assert(
      result.findings.some(
        (f) =>
          f.anchor.path === "cache.py" &&
          f.anchor.startLine === 4 &&
          f.anchorValidation.status === "verified",
      ),
      "Expected tenant cache-key regression",
    );
    assert(
      result.evidence.some(
        (e) => e.kind === "source-read" && e.location.path === "caller.py",
      ),
      "Expected actual caller inspection",
    );
    proof.actualFollowupReview = true;
    proof.externalModelCalls = 1;
    proof.model = "gpt-6-astra";
    proof.reasoningEffort = "xhigh";
    proof.snapshotId = expected.snapshotId;
    proof.ruleId = expected.ruleId;
    proof.findingCount = result.findings.length;
    proof.reportSha256 = contentHash(result);
    proof.status = "passed";
    save();
  } catch (error) {
    proof.status = "failed";
    proof.error = error instanceof Error ? error.message : "unknown";
    save();
    throw error;
  } finally {
    if (connectionId) {
      await connections.disconnect(connectionId);
      proof.credentialRemoved = true;
    }
    connections.close();
    save();
  }
}
