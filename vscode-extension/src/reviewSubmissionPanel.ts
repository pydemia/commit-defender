import * as vscode from "vscode";
import { clientReviewReport } from "@gcr/client-contract";
import { contentHash } from "@gcr/client-core";
import { getStandaloneReviewSettings } from "./config.js";
import { knowledgeScope } from "./localKnowledge.js";
import { readSelection, selectedReviewSettings } from "./centralConnection.js";
import {
  ReviewSubmissionSession,
  SubmissionSessionError,
  type SubmissionEntry,
} from "./reviewSubmissionSession.js";
import {
  ReviewSubmissionView,
  type SubmissionMessage,
} from "./reviewSubmissionView.js";
import type { AnalysisReport } from "./types.js";

const panels = new Map<string, vscode.WebviewPanel>();
const jobs = new Set<Promise<void>>();
export async function settleReviewSubmissions() {
  for (const panel of panels.values()) panel.dispose();
  await Promise.allSettled([...jobs]);
}
export async function openReviewSubmission(
  report: AnalysisReport,
  repoRoot: string,
  context: vscode.ExtensionContext,
) {
  if (!report.gcr) {
    void vscode.window.showInformationMessage(
      "Open a saved fixed-source review to submit feedback.",
    );
    return;
  }
  const core = clientReviewReport(report.gcr.report);
  const scope = knowledgeScope({
    repoRoot,
    profileId: core.identity.client.profileId,
    scope: "repository",
  });
  const settings = () =>
    selectedReviewSettings(
      getStandaloneReviewSettings(
        ["commit", "push"].includes(core.trigger) ? 2 : core.files.length,
        repoRoot,
      ),
      readSelection(context.globalState, scope),
    );
  const initial = settings(),
    fingerprint = contentHash(initial);
  if (
    !initial.workspaceTrusted ||
    !vscode.workspace.isTrusted ||
    initial.profileId !== scope.profileId ||
    initial.mode !== "centralized" ||
    !initial.connectionId
  ) {
    void vscode.window.showInformationMessage(
      "Select a central connection in this trusted workspace and profile before submitting feedback.",
    );
    return;
  }
  const key = contentHash({ repoRoot, runId: core.runId, fingerprint });
  if (panels.has(key)) {
    panels.get(key)!.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    "commitDefenderReviewSubmission",
    "Commit Defender — Review feedback",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    },
  );
  panels.set(key, panel);
  const view = new ReviewSubmissionView();
  const controller = new AbortController();
  let closed = false,
    session: ReviewSubmissionSession | undefined,
    running: Promise<void> | undefined;
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
  const execute = async (message: SubmissionMessage) => {
    try {
      if (!session)
        session = await ReviewSubmissionSession.open({
          repoRoot,
          profileId: initial.profileId,
          connectionId: initial.connectionId!,
          report: core,
          current,
        });
      if (!current()) return;
      let preview,
        entry: SubmissionEntry | undefined,
        notice = "";
      switch (message.command) {
        case "prepare":
          preview = await session.prepare(message.selection);
          break;
        case "select":
          preview = await session.select(message.id);
          break;
        case "save":
          entry = await session.save(message.hash);
          notice =
            entry.status === "pending"
              ? "Saved to the encrypted outbox. Nothing was sent by this action."
              : deliveryNotice(entry);
          break;
        case "send":
          entry = await session.send(message.hash, controller.signal);
          notice = deliveryNotice(entry);
          break;
        case "cancel":
          entry = await session.cancel(message.id);
          notice =
            "Local retries cancelled. Any prior server receipt remains valid.";
          break;
        case "memory": {
          const memory = await session.saveLocalCandidate(message.hash);
          notice = `Local memory candidate saved (${memory.id}). Review and activate it in Local Knowledge.`;
          break;
        }
      }
      const entries = await session.list();
      post({
        type: "state",
        destination: session.destination,
        ...(message.command === "ready"
          ? {
              findings: core.findings.map((f) => ({
                id: f.id,
                title: f.title,
              })),
            }
          : {}),
        ...(preview ? { preview } : {}),
        entries,
        message: notice,
      });
    } catch (error) {
      post({ type: "error", message: submissionError(error) });
    }
  };
  const timer = setInterval(() => {
    if (!current()) panel.dispose();
  }, 500);
  panel.onDidDispose(() => {
    closed = true;
    clearInterval(timer);
    controller.abort();
    panels.delete(key);
    if (!running) {
      session?.close();
      session = undefined;
    }
  });
  panel.webview.onDidReceiveMessage(
    (raw) => {
      if (!current() || running) return;
      const message = view.message(raw);
      if (!message) return;
      const promise = execute(message).finally(() => {
        jobs.delete(promise);
        running = undefined;
        if (closed) {
          session?.close();
          session = undefined;
        }
      });
      running = promise;
      jobs.add(promise);
    },
    undefined,
    context.subscriptions,
  );
  context.subscriptions.push(panel);
  panel.webview.html = view.html();
}
function deliveryNotice(entry: SubmissionEntry) {
  if (entry.status === "submitted")
    return "Received by the server as client-reported evidence. Rule and exception approval is a separate step.";
  if (entry.status === "rejected")
    return "The server rejected this submission. Check the selected account and its submission permissions before explicitly retrying.";
  if (entry.status === "cancelled")
    return "This outbox entry is cancelled. Prepare a new submission if needed.";
  return "Delivery is unconfirmed. Review the saved entry and choose Submit now to retry with the same request ID.";
}
function submissionError(error: unknown) {
  if (error instanceof SubmissionSessionError) {
    if (error.code === "report-mismatch")
      return "This review does not match the saved history in the current workspace, profile, and connection.";
    if (error.code === "confirmation-required")
      return "Preview the content again and confirm it before continuing.";
    if (error.code === "selection-changed")
      return "The workspace or central connection changed. Reopen this review under the intended connection.";
  }
  // Raw transport and storage diagnostics may contain credential or local-path data.
  return "The action could not be confirmed. Check the central connection and saved outbox before retrying; a prior server delivery may still have succeeded.";
}
