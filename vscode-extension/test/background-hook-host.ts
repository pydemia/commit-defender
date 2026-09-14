import * as vscode from "vscode";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  callLocalService,
  discoverLocalIdentity,
  LocalRecordStore,
  LocalHistoryStore,
  type ServiceJob,
} from "@gcr/client-core";
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeout = 300000,
) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline)
      throw Error("Background hook verification observation timed out.");
    await new Promise((r) => setTimeout(r, 500));
  }
}
export async function run() {
  const root = process.env.CD_HOOK_WORKSPACE!,
    profileId = process.env.CD_HOOK_PROFILE!,
    evidence = process.env.CD_HOOK_EVIDENCE!;
  const proof: Record<string, any> = {
    status: "running",
    vscode: vscode.version,
    runtime: process.version,
    events: [],
  };
  const checkpoint = () =>
    writeFileSync(evidence, JSON.stringify(proof, null, 2) + "\n", {
      mode: 0o600,
    });
  checkpoint();
  const git = (...args: string[]) =>
    execFileSync(
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
      { encoding: "utf8", stdio: "pipe", timeout: 60000 },
    ).trim();
  const cfg = vscode.workspace.getConfiguration("commitDefender");
  const location = { profileId };
  const status = () =>
    callLocalService(location, { action: "status" }) as Promise<{
      jobs: ServiceJob[];
      pid: number;
    }>;
  const identity = discoverLocalIdentity(root, profileId);
  const scope = {
    kind: "repository" as const,
    profileId,
    repositoryKey: identity.repositoryKey,
    worktreeKey: identity.worktreeKey,
  };
  try {
    await vscode.extensions.getExtension("pydemia.commit-defender")!.activate();
    assert.equal(cfg.get("runOnCommit"), false);
    assert.equal(cfg.get("runOnPush"), false);
    await cfg.update("runOnCommit", true, vscode.ConfigurationTarget.Global);
    await cfg.update("runOnPush", true, vscode.ConfigurationTarget.Global);
    await until(
      async () => {
        try {
          const reg = (await callLocalService(location, {
            action: "registration",
            root,
          })) as { triggers: string[] };
          return (
            reg?.triggers.includes("commit") &&
            reg.triggers.includes("push") &&
            git("config", "core.hooksPath").includes("managed-hooks")
          );
        } catch {
          return false;
        }
      },
      (ready) => ready,
      90000,
    );
    proof.servicePid = (await status()).pid;
    proof.hookDirectory = git("config", "core.hooksPath");
    checkpoint();
    const base = git("rev-parse", "HEAD");
    writeFileSync(
      path.join(root, "unrelated.ts"),
      "export const unrelated = 2;\n",
    );
    git("add", "unrelated.ts");
    writeFileSync(
      path.join(root, "sum.ts"),
      "export const sum = (values: number[]) => values.reduce((a, b) => a + b);\n",
    );
    git("commit", "--only", "-m", "defect fixture", "--", "sum.ts");
    const first = (await status()).jobs.find((job) => job.trigger === "commit");
    assert(first);
    assert(["queued", "running"].includes(first.state));
    proof.events.push({
      trigger: "commit",
      receiptId: first.id,
      stateAfterGitReturned: first.state,
    });
    checkpoint();
    const readReport = async (id: string) => {
      const job = await until(
        () =>
          callLocalService(location, {
            action: "job",
            id,
          }) as Promise<ServiceJob>,
        (row) => !["queued", "running"].includes(row.state),
      );
      assert.equal(job.result?.status, "completed");
      assert(job.result?.runId);
      const records = await LocalRecordStore.open({ scope });
      try {
        const report = await new LocalHistoryStore(records).getReview(
          job.result.runId,
        );
        assert(report);
        assert(report.findings.length > 0);
        return report;
      } finally {
        records.close();
      }
    };
    const committed = await readReport(first.id);
    proof.events[0].report = committed;
    checkpoint();
    assert.equal(committed.identity.source.kind, "index");
    assert(committed.identity.source.kind === "index");
    assert.equal(
      committed.identity.source.sourceTree,
      git("rev-parse", "HEAD^{tree}"),
    );
    assert.equal(committed.identity.source.baseCommit, base);
    assert.equal(git("show", ":unrelated.ts"), "export const unrelated = 2;");
    assert.equal(
      git("show", "HEAD:unrelated.ts"),
      "export const unrelated = 1;",
    );
    git("push", "fixture", "main");
    const second = (await status()).jobs.find((job) => job.trigger === "push");
    assert(second);
    assert(["queued", "running"].includes(second.state));
    proof.events.push({
      trigger: "push",
      receiptId: second.id,
      stateAfterGitReturned: second.state,
    });
    checkpoint();
    const pushed = await readReport(second.id);
    proof.events[1].report = pushed;
    assert.equal(pushed.identity.source.kind, "commit-tree");
    assert.equal(pushed.identity.source.sourceCommit, git("rev-parse", "HEAD"));
    assert.equal(pushed.identity.source.baseCommit, base);
    proof.partialCommitTreeMatched = true;
    proof.unrelatedIndexPreserved = true;
    proof.gitReturnedBeforeReviews = true;
    await vscode.commands.executeCommand("commitDefender.refreshLocalHistory");
    await cfg.update(
      "automaticReviewsPaused",
      true,
      vscode.ConfigurationTarget.Global,
    );
    await until(
      async () => {
        try {
          git("config", "--local", "--get", "core.hooksPath");
          return false;
        } catch {
          return true;
        }
      },
      (restored) => restored,
      30000,
    );
    const reg = (await callLocalService(location, {
      action: "registration",
      root,
    })) as { triggers: string[] };
    assert(!reg.triggers.includes("commit"));
    assert(!reg.triggers.includes("push"));
    proof.pauseRestoredHooksAndRevokedGrants = true;
    proof.status = "verified";
    checkpoint();
  } catch (error) {
    proof.status = "failed";
    proof.failure =
      error instanceof assert.AssertionError
        ? error.message
        : "Background hook host verification failed.";
    checkpoint();
    throw error;
  } finally {
    await cfg.update(
      "automaticReviewsPaused",
      true,
      vscode.ConfigurationTarget.Global,
    );
  }
}
