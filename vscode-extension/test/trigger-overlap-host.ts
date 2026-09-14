import * as vscode from "vscode";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  callLocalService,
  discoverLocalIdentity,
  LocalRecordStore,
  LocalHistoryStore,
  ReviewRequests,
  type ServiceJob,
} from "@gcr/client-core";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function run() {
  const root = await realpath(process.env.CD_OVERLAP_WORKSPACE!);
  const profileId = process.env.CD_OVERLAP_PROFILE!;
  const evidence = process.env.CD_OVERLAP_EVIDENCE!;
  const invocations = process.env.CD_OVERLAP_INVOCATIONS!;
  const proof = JSON.parse(await readFile(evidence, "utf8"));
  const checkpoint = async () =>
    writeFile(evidence, JSON.stringify(proof, null, 2) + "\n");
  const until = async <T>(
    read: () => Promise<T>,
    done: (value: T) => boolean,
    label: string,
  ) => {
    let observedAt = Date.now();
    for (;;) {
      const value = await read();
      if (done(value)) return value;
      if (Date.now() - observedAt > 60000) {
        proof.waitingFor = label;
        proof.observationExtendedAt = new Date().toISOString();
        await checkpoint();
        observedAt = Date.now();
      }
      await delay(300);
    }
  };
  const git = async (...args: string[]) =>
    (
      await promisify(execFile)(
        "git",
        [
          "-C",
          root,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { encoding: "utf8", timeout: 45000 },
      )
    ).stdout.trim();
  const location = { profileId };
  const identity = discoverLocalIdentity(root, profileId);
  const scope = {
    kind: "repository" as const,
    profileId,
    repositoryKey: identity.repositoryKey,
    worktreeKey: identity.worktreeKey,
  };
  const journal = await ReviewRequests.open({ scope });
  const records = await LocalRecordStore.open({ scope });
  const history = new LocalHistoryStore(records);
  const status = async () =>
    (await callLocalService(location, { action: "status" })) as {
      pid: number;
      jobs: ServiceJob[];
    };
  const invocationCount = async () =>
    (await readFile(invocations, "utf8"))
      .trim()
      .split("\n")
      .filter((line) => line === "review-exec").length;
  try {
    const extension = vscode.extensions.getExtension("pydemia.commit-defender");
    assert(extension);
    await extension.activate();
    proof.vscode = vscode.version;
    proof.extensionVersion = extension.packageJSON.version;
    await until(
      async () => {
        const row = await records.read(
          "settings",
          "automatic-stage-observation-v1",
        );
        try {
          const reg = (await callLocalService(location, {
            action: "registration",
            root,
          })) as { triggers: string[] } | null;
          return (
            row &&
            !row.deleted &&
            (row.value as any).enabled &&
            reg?.triggers.includes("commit")
          );
        } catch {
          return false;
        }
      },
      Boolean,
      "Stage baseline and Commit registration",
    );
    proof.hookDirectory = await git("config", "core.hooksPath");
    proof.servicePid = (await status()).pid;
    assert.equal((await journal.list()).length, 0);
    assert.equal(await invocationCount(), 0);
    proof.phase = "baseline-ready";
    await checkpoint();
    await writeFile(
      path.join(root, "sum.ts"),
      "export const sum = (values: number[]) => values.reduce((a, b) => a + b);\n",
    );
    await git("add", "sum.ts");
    const running = await until(
      () => journal.list(),
      (rows) => {
        assert.ok(
          rows.length <= 1,
          "Only the Stage request may exist before hook submission",
        );
        assert.ok(
          !rows.some((row) => row.state === "finished"),
          "Model completed before overlap was established",
        );
        return rows.length === 1 && rows[0].state === "running";
      },
      "Stage owner running",
    );
    await until(invocationCount, (n) => n > 0, "real Codex exec started");
    assert.equal(await invocationCount(), 1);
    proof.ownerBeforeHook = {
      key: running[0].key,
      generation: running[0].generation,
      state: running[0].state,
      reasons: running[0].reasons,
    };
    proof.phase = "stage-model-running";
    await checkpoint();
    // Submit the actual pre-commit hook while the index owner is executing. Keep
    // HEAD fixed until the shared report is saved so this tests joining, not cancellation.
    await git("hook", "run", "pre-commit");
    const overlap = await until(
      async () => ({ requests: await journal.list(), service: await status() }),
      (s) => {
        assert.equal(
          s.requests.length,
          1,
          "Hook must join the Stage execution identity",
        );
        assert.equal(
          s.requests[0].state,
          "running",
          "Joining must be observed before model completion",
        );
        assert.ok(
          !s.service.jobs.some((job) =>
            ["failed", "interrupted"].includes(job.state),
          ),
        );
        return (
          s.requests[0].reasons.includes("commit") &&
          s.service.jobs.length === 1 &&
          s.service.jobs[0].state === "running"
        );
      },
      "Commit hook joins running Stage owner",
    );
    proof.overlap = {
      request: overlap.requests[0],
      jobs: overlap.service.jobs,
      invocationCount: await invocationCount(),
    };
    assert.equal(proof.overlap.invocationCount, 1);
    proof.phase = "overlap-observed";
    await checkpoint();
    const finished = await until(
      async () => ({ requests: await journal.list(), service: await status() }),
      (s) => {
        assert.equal(s.requests.length, 1);
        assert.ok(
          !s.service.jobs.some((job) =>
            ["failed", "interrupted"].includes(job.state),
          ),
          JSON.stringify(s.service.jobs),
        );
        return (
          s.requests[0].state === "finished" &&
          s.service.jobs[0]?.state === "finished"
        );
      },
      "original model and joined hook complete",
    );
    const request = finished.requests[0];
    assert.equal(request.generation, 1);
    assert.deepEqual([...request.reasons].sort(), ["commit", "stage"]);
    assert(request.resultId);
    const report = await history.getReview(request.resultId);
    assert(report);
    proof.report = report;
    proof.phase = "shared-report-saved";
    await checkpoint();
    assert.equal(report.status, "completed");
    assert.equal(report.trigger, "stage");
    assert.equal(report.identity.source.kind, "index");
    assert(report.findings.length > 0);
    assert.equal(finished.service.jobs[0].result?.runId, report.runId);
    await until(
      async () => {
        const row = await records.read(
          "settings",
          "automatic-stage-observation-v1",
        );
        return (
          row && !row.deleted && (row.value as any).pendingPaths.length === 0
        );
      },
      Boolean,
      "Stage acknowledgement",
    );
    await git("commit", "-m", "Verified overlap fixture");
    const committed = await until(
      status,
      (s) =>
        s.jobs.length === 2 && s.jobs.every((job) => job.state === "finished"),
      "actual commit reuses original result",
    );
    for (const job of committed.jobs) {
      assert.equal(job.execution?.key, request.key);
      assert.equal(job.execution?.generation, 1);
      assert.equal(job.result?.runId, report.runId);
      assert.equal(job.result?.status, "completed");
    }
    assert.equal((await journal.list()).length, 1);
    assert.equal((await history.listReviews()).length, 1);
    assert.equal(await invocationCount(), 1);
    proof.jobsAfterActualCommit = committed.jobs;
    proof.modelExecInvocations = 1;
    proof.currentCommit = await git("rev-parse", "HEAD");
    proof.stageAcknowledged = true;
    const cfg = vscode.workspace.getConfiguration("commitDefender");
    await cfg.update(
      "automaticReviewsPaused",
      true,
      vscode.ConfigurationTarget.Global,
    );
    await until(
      async () => {
        try {
          await git("config", "--local", "--get", "core.hooksPath");
          return false;
        } catch {
          return true;
        }
      },
      Boolean,
      "owned hook revocation",
    );
    const reg = (await callLocalService(location, {
      action: "registration",
      root,
    })) as { triggers: string[] };
    assert(!reg.triggers.includes("commit"));
    proof.status = "verified";
    proof.phase = "verified";
    delete proof.waitingFor;
    await checkpoint();
  } catch (error) {
    proof.status = "failed";
    proof.failure =
      error instanceof Error
        ? error.message
        : "Native overlap verification failed";
    await checkpoint();
    throw error;
  } finally {
    journal.close();
    records.close();
  }
}
