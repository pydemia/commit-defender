import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { clientReviewReport } from "@gcr/client-contract";
import { contentHash } from "@gcr/client-core";
import { getStandaloneReviewSettings } from "./config.js";
import { knowledgeScope } from "./localKnowledge.js";
import { readSelection, selectedReviewSettings } from "./centralConnection.js";
import { ReviewChatView } from "./reviewChatView.js";
import { runReviewChatWorker } from "./reviewChatWorkerClient.js";
import {
  chatError,
  type ReviewChatAction,
  type ReviewChatTarget,
} from "./reviewChatProtocol.js";
import { reviewNavigation } from "./reviewNavigation.js";
import type { AnalysisReport } from "./types.js";

const panels = new Map<string, { reveal(): void; dispose(): void }>();
const active = new Set<{
  controller: AbortController;
  promise: Promise<unknown>;
}>();
export async function settleReviewChats() {
  for (const panel of panels.values()) panel.dispose();
  for (const job of active) job.controller.abort();
  await Promise.allSettled([...active].map((job) => job.promise));
}
export async function openReviewChat(
  report: AnalysisReport,
  repoRoot: string,
  context: vscode.ExtensionContext,
) {
  if (!report.gcr) {
    void vscode.window.showInformationMessage(
      "Run a fixed-source review before starting a review conversation.",
    );
    return;
  }
  const core = clientReviewReport(report.gcr.report);
  const target: ReviewChatTarget = {
    repoRoot,
    reportId: core.runId,
    mode: core.identity.client.mode,
  };
  const fileCount = ["commit", "push"].includes(core.trigger)
    ? 2
    : core.files.length;
  const scope = knowledgeScope({
    repoRoot,
    profileId: core.identity.client.profileId,
    scope: "repository",
  });
  const settings = () =>
    selectedReviewSettings(
      getStandaloneReviewSettings(fileCount, repoRoot),
      readSelection(context.globalState, scope),
    );
  const initial = settings(),
    fingerprint = contentHash(initial);
  if (
    initial.profileId !== core.identity.client.profileId ||
    !initial.workspaceTrusted ||
    scope.kind !== "repository" ||
    scope.repositoryKey !== core.identity.client.repositoryKey ||
    scope.worktreeKey !== core.identity.client.worktreeKey
  ) {
    void vscode.window.showErrorMessage(
      "Reopen this review from the current trusted workspace and profile.",
    );
    return;
  }
  const key = contentHash({ target, fingerprint });
  if (panels.has(key)) {
    panels.get(key)!.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    "commitDefenderReviewChat",
    "Commit Defender — Review conversation",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    },
  );
  const view = new ReviewChatView();
  let closed = false,
    running:
      { controller: AbortController; promise: Promise<unknown> } | undefined,
    cancelRequested = false;
  const current = () => {
    try {
      return (
        !closed &&
        vscode.workspace.isTrusted &&
        contentHash(settings()) === fingerprint
      );
    } catch {
      return false;
    }
  };
  const post = (value: object) => {
    if (current())
      void panel.webview.postMessage({ ...value, viewId: view.id });
  };
  const workerFile = context.asAbsolutePath("out/review-chat-worker.js");
  const execute = async (action: ReviewChatAction) => {
    if (!current() || running) return;
    post({
      type: "progress",
      message:
        action.type === "source"
          ? "Opening the saved source…"
          : action.type === "read"
            ? "Opening the saved conversation…"
            : "Checking the conversation before continuing…",
    });
    const controller = new AbortController();
    const promise = runReviewChatWorker(
      workerFile,
      target,
      action,
      settings(),
      controller.signal,
      (message) => post({ type: "progress", message }),
    );
    const job = { controller, promise };
    running = job;
    active.add(job);
    try {
      const result = await promise;
      if (!current()) return;
      if (result.type === "state") {
        if (
          (action.type === "send" || action.type === "answer") &&
          result.state.conversation.turns.some(
            (t) =>
              t.id === action.turnId &&
              (action.type === "send"
                ? t.content === action.content
                : t.questions.some(
                    (q) =>
                      q.id === action.questionId && q.answer === action.content,
                  )),
          )
        )
          post({ type: "accepted", content: action.content });
        post(view.render(result.state));
      } else {
        await reviewNavigation.openCaptured(result, current);
        if (view.state) post(view.render(view.state));
      }
    } catch (error) {
      post({ type: "error", message: chatError(error).message });
    } finally {
      active.delete(job);
      if (running === job) running = undefined;
      if (cancelRequested && current()) {
        cancelRequested = false;
        const turnId =
          "turnId" in action
            ? action.turnId
            : view.state?.conversation.turns.at(-1)?.id;
        if (turnId) await execute({ type: "cancel", turnId });
        else await execute({ type: "read" });
      }
    }
  };
  const timer = setInterval(() => {
    if (!current()) panel.dispose();
  }, 500);
  panel.onDidDispose(() => {
    closed = true;
    clearInterval(timer);
    running?.controller.abort();
    panels.delete(key);
  });
  const lifetime = {
    reveal: () => panel.reveal(),
    dispose: () => panel.dispose(),
  };
  panels.set(key, lifetime);
  context.subscriptions.push(panel);
  panel.webview.onDidReceiveMessage(
    async (value) => {
      if (!current()) return;
      const message = view.message(value);
      if (!message) return;
      if (message.command === "cancel") {
        if (running) {
          cancelRequested = true;
          running.controller.abort();
          post({
            type: "progress",
            message: "Cancelling and waiting for the model process to exit…",
          });
        } else {
          const turn = view.state?.conversation.turns.at(-1);
          if (turn) await execute({ type: "cancel", turnId: turn.id });
        }
        return;
      }
      if (running) return;
      if (message.command === "ready" || message.command === "refresh")
        await execute({ type: "read" });
      else if (message.command === "source") {
        const citation = view.source(message.id);
        if (citation) await execute({ type: "source", ...citation });
      } else if (message.command === "finding") {
        const content = view.finding(message.id);
        if (content) post({ type: "draft", content });
      } else if (message.command === "resume") {
        const turn = view.state?.conversation.turns.at(-1);
        if (turn?.status === "queued")
          await execute({ type: "resume", turnId: turn.id });
      } else if (message.command === "send") {
        const turn = view.state?.conversation.turns.at(-1),
          question = turn?.questions.at(-1);
        if (turn?.status === "awaiting_input" && question)
          await execute({
            type: "answer",
            turnId: turn.id,
            questionId: question.id,
            content: message.content,
          });
        else if (
          view.state &&
          (!turn || !["queued", "running"].includes(turn.status))
        )
          await execute({
            type: "send",
            turnId: randomUUID(),
            content: message.content,
          });
      }
    },
    undefined,
    context.subscriptions,
  );
  panel.webview.html = view.html;
}
