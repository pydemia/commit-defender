import * as vscode from "vscode";
import assert from "node:assert/strict";
import { readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  discoverLocalIdentity,
  LocalRecordStore,
  LocalHistoryStore,
  ReviewRequests,
  observeAutomaticRepository,
} from "@gcr/client-core";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function run() {
  const root = await realpath(process.env.CD_CATCHUP_WORKSPACE!),
    profileId = process.env.CD_CATCHUP_PROFILE!,
    phase = process.env.CD_CATCHUP_PHASE!,
    evidence = process.env.CD_CATCHUP_EVIDENCE!;
  const extension = vscode.extensions.getExtension("pydemia.commit-defender");
  assert(extension);
  await extension.activate();
  const client = discoverLocalIdentity(root, profileId);
  const scope = {
    kind: "repository" as const,
    profileId,
    repositoryKey: client.repositoryKey,
    worktreeKey: client.worktreeKey,
  };
  const read = async () => {
    const records = await LocalRecordStore.open({ scope });
    try {
      return {
        checkpoint: await records.read(
          "settings",
          "automatic-stage-observation-v1",
        ),
        reviews: await new LocalHistoryStore(records).listReviews(),
      };
    } finally {
      records.close();
    }
  };
  const deadline = Date.now() + (phase === "review" ? 720000 : 60000);
  let state = await read();
  while (!(
    state.checkpoint &&
    !state.checkpoint.deleted &&
    (state.checkpoint.value as any).enabled &&
    (phase !== "review" || state.reviews.length > 0)
  )) {
    if (Date.now() > deadline)
      throw Error(
        `Native ${phase} observation expired; no new host or model was started.`,
      );
    await delay(300);
    state = await read();
  }
  const checkpoint =
    state.checkpoint && !state.checkpoint.deleted
      ? (state.checkpoint.value as any)
      : undefined;
  const observed = await observeAutomaticRepository(root);
  if (phase === "baseline") {
    assert.equal(state.reviews.length, 0);
    assert.equal(checkpoint.observed.fingerprint, observed.fingerprint);
    assert.deepEqual(checkpoint.pendingPaths, []);
  } else {
    assert.equal(state.reviews.length, 1);
    const records = await LocalRecordStore.open({ scope });
    let report;
    try {
      report = await new LocalHistoryStore(records).getReview(
        state.reviews[0].runId,
      );
    } finally {
      records.close();
    }
    assert(report);
    const observedProof = JSON.parse(await readFile(evidence, "utf8"));
    observedProof.phases[phase] = {
      status: "observed",
      vscode: vscode.version,
      report,
    };
    await writeFile(evidence, JSON.stringify(observedProof, null, 2) + "\n");
    assert.equal(report.status, "completed");
    assert.equal(report.trigger, "stage");
    assert.equal(report.identity.source.kind, "index");
    assert(report.findings.length > 0);
    while (
      (state.checkpoint &&
        !state.checkpoint.deleted &&
        (state.checkpoint.value as any).pendingPaths.length) ||
      (phase === "review" &&
        !vscode.languages.getDiagnostics(
          vscode.Uri.file(path.join(root, "sum.ts")),
        ).length)
    ) {
      if (Date.now() > deadline)
        throw Error("Review was saved but checkpoint/UI did not settle.");
      await delay(300);
      state = await read();
    }
    const requests = await ReviewRequests.open({ scope });
    try {
      const all = await requests.list();
      assert.equal(all.length, 1);
      assert.equal(all[0].state, "finished");
      assert.equal(all[0].generation, 1);
    } finally {
      requests.close();
    }
    if (phase === "reopen") {
      await delay(12000);
      state = await read();
      assert.equal(state.reviews.length, 1);
      assert.equal(state.reviews[0].runId, report.runId);
      const previous = JSON.parse(await readFile(evidence, "utf8"));
      assert.equal(previous.phases.review.report.runId, report.runId);
    }
    const proof = JSON.parse(await readFile(evidence, "utf8"));
    proof.phases[phase] = {
      status: "passed",
      vscode: vscode.version,
      extensionVersion: extension.packageJSON.version,
      report,
      diagnosticCount: vscode.languages.getDiagnostics(
        vscode.Uri.file(path.join(root, "sum.ts")),
      ).length,
      requestGeneration: 1,
    };
    await writeFile(evidence, JSON.stringify(proof, null, 2) + "\n");
    return;
  }
  const proof = JSON.parse(await readFile(evidence, "utf8"));
  proof.phases[phase] = {
    status: "passed",
    vscode: vscode.version,
    extensionVersion: extension.packageJSON.version,
    fingerprint: observed.fingerprint,
    reviews: 0,
  };
  await writeFile(evidence, JSON.stringify(proof, null, 2) + "\n");
}
