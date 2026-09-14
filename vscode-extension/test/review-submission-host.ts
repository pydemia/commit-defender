import * as vscode from "vscode";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  contentHash,
  CentralConnections,
  ReviewSubmissionQueue,
  LocalRecordStore,
  LocalKnowledgeStore,
} from "@gcr/client-core";
import { projectCommitDefender } from "@gcr/client-contract";
import { centralFixture } from "./helpers/central-fixture.js";
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
    syntheticReview: true,
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
  const central = await centralFixture(path.dirname(workspace));
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
      { repoRoot: workspace, files: ["sum.ts"], scope: "staged" },
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
                    path: "sum.ts",
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
                    path: "sum.ts",
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
    await until(async () => controls().reopen === true);
    const queue = await ReviewSubmissionQueue.open({
      scope,
      connectionId,
      connections,
    });
    try {
      const saved = await queue.list();
      assert.equal(saved.length, 1);
      assert.equal(saved[0].value.status, "pending");
      assert.equal(central.submissionCalls, 0);
      const tab = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .find(
          (t) =>
            t.input instanceof vscode.TabInputWebview &&
            t.input.viewType.includes("commitDefenderReviewSubmission"),
        );
      assert(tab);
      await vscode.window.tabGroups.close(tab);
      await open();
      central.setSubmissionStatus(200);
      proof.stage = "reopened";
      save();
      await until(async () => controls().finish === true);
      const result = (await queue.list())[0].value;
      assert.equal(result.status, "submitted");
      assert.equal(central.submissionCalls, 1);
      assert(
        !JSON.stringify(result.payload).includes("PRIVATE_NATIVE_REVIEW_PROSE"),
      );
      const records = await LocalRecordStore.open({ scope });
      try {
        const entries = await new LocalKnowledgeStore(records).list();
        assert.equal(entries.length, 1);
        assert.equal(entries[0].state, "candidate");
        proof.localCandidateId = entries[0].id;
      } finally {
        records.close();
      }
      await vscode.workspace
        .getConfiguration("commitDefender")
        .update(
          "model",
          "changed-by-fixture",
          vscode.ConfigurationTarget.Global,
        );
      await until(
        async () =>
          !vscode.window.tabGroups.all
            .flatMap((g) => g.tabs)
            .some(
              (t) =>
                t.input instanceof vscode.TabInputWebview &&
                t.input.viewType.includes("commitDefenderReviewSubmission"),
            ),
      );
      proof.status = "passed";
      proof.stage = "selection-change-closed-panel";
      proof.extensionVersion = extension.packageJSON.version;
      proof.requestId = result.payload.id;
      proof.receipt = result.receipt;
      proof.submissionCalls = central.submissionCalls;
      save();
    } finally {
      queue.close();
    }
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
    await central.close();
    save();
  }
}
