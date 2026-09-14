import * as vscode from "vscode";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  discoverLocalIdentity,
  LocalRecordStore,
  LocalHistoryStore,
  ReviewConversationStore,
} from "@gcr/client-core";
import { projectCommitDefender } from "@gcr/client-contract";
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeout = 660000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline)
      throw Error(
        "Chat host observation timed out; no execution was restarted.",
      );
    await new Promise((r) => setTimeout(r, 500));
  }
}
export async function run() {
  const root = process.env.CD_CHAT_WORKSPACE!,
    profileId = process.env.CD_CHAT_PROFILE!,
    evidence = process.env.CD_CHAT_EVIDENCE!,
    control = process.env.CD_CHAT_CONTROL!;
  const proof: Record<string, any> = {
    status: "running",
    stage: "review",
    vscode: vscode.version,
    node: process.version,
  };
  const save = () =>
    writeFileSync(evidence, JSON.stringify(proof, null, 2) + "\n", {
      mode: 0o600,
    });
  save();
  const controls = () => {
    try {
      return JSON.parse(readFileSync(control, "utf8"));
    } catch {
      return {};
    }
  };
  await vscode.extensions.getExtension("pydemia.commit-defender")!.activate();
  const resumed = process.env.CD_CHAT_RESUMED === "1";
  if (!resumed) await vscode.commands.executeCommand("commitDefender.analyze");
  const client = discoverLocalIdentity(root, profileId);
  const records = await LocalRecordStore.open({
    scope: {
      kind: "repository",
      profileId,
      repositoryKey: client.repositoryKey,
      worktreeKey: client.worktreeKey,
    },
  });
  try {
    const report = (await new LocalHistoryStore(records).listReviews())[0];
    assert(report);
    if (report.status !== "completed") {
      proof.status = "failed";
      proof.stage = "review-failed";
      proof.review = {
        runId: report.runId,
        status: report.status,
        problems: report.problems,
        durationMs: report.durationMs,
      };
      save();
    }
    assert.equal(report.status, "completed");
    const conversations = new ReviewConversationStore(records);
    if (!resumed)
      assert.equal(
        (await conversations.get(report.runId)).conversation.turns.length,
        0,
      );
    const open = () =>
      vscode.commands.executeCommand("commitDefender.openReviewChat", {
        report: projectCommitDefender(report),
        repoRoot: root,
      });
    const read = async () =>
      (await conversations.get(report.runId)).conversation;
    await open();
    proof.stage = "chat-open";
    proof.reportId = report.runId;
    proof.sourceHash = report.identity.source.hash;
    save();
    if (!resumed) {
      const pending = await until(
        read,
        (c) => c.turns[0]?.status === "awaiting_input",
      );
      proof.question = pending.turns[0].questions[0];
      proof.stage = "question-saved";
      save();
      await until(
        async () => controls(),
        (c) => c.reopen === true,
      );
      const tab = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .find(
          (t) =>
            t.input instanceof vscode.TabInputWebview &&
            t.input.viewType.includes("commitDefenderReviewChat"),
        );
      assert(tab);
      await vscode.window.tabGroups.close(tab);
      writeFileSync(
        path.join(root, "sum.ts"),
        "POST_CHAT_LIVE_SOURCE_CANARY\n",
      );
      await open();
      proof.stage = "reopened";
      save();
    }
    const complete = await until(
      read,
      (c) => c.turns[0]?.status === "completed",
    );
    assert(complete.turns[0].response!.citations.length > 0);
    proof.completed = complete.turns[0];
    proof.stage = "answer-complete";
    save();
    await until(
      async () => vscode.window.activeTextEditor,
      (editor) => editor?.document.uri.scheme === "commit-defender-source",
    );
    const editor = vscode.window.activeTextEditor!;
    assert(!editor.document.getText().includes("POST_CHAT_LIVE_SOURCE_CANARY"));
    assert.equal(editor.document.isUntitled, false);
    proof.navigation = {
      scheme: editor.document.uri.scheme,
      line: editor.selection.start.line + 1,
      originalSource: true,
    };
    proof.stage = "navigation-verified";
    save();
    await until(
      async () => controls(),
      (c) => c.returnToChat === true,
    );
    await open();
    proof.stage = "navigation-returned";
    save();
    await until(read, (c) => c.turns[1]?.status === "running");
    proof.stage = "cancel-running";
    save();
    const cancelled = await until(
      read,
      (c) => c.turns[1]?.status === "cancelled",
    );
    proof.cancelled = {
      status: cancelled.turns[1].status,
      response: cancelled.turns[1].response,
    };
    assert.equal(cancelled.turns[1].response, null);
    proof.stage = "cancelled";
    save();
    await until(
      async () => controls(),
      (c) => c.finish === true,
    );
    proof.status = "passed";
    proof.stage = "finished";
    save();
  } catch (error) {
    proof.status = "failed";
    proof.error = error instanceof Error ? error.message : "host-failed";
    save();
    throw error;
  } finally {
    records.close();
  }
}
