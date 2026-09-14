import * as vscode from "vscode";
import path from "node:path";
import type {
  BackgroundHooks,
  BackgroundReviewJob,
} from "./backgroundHooks.js";

export async function recoverBackgroundReview(
  hooks: Pick<BackgroundHooks, "status" | "reconcile">,
  refreshHistory: () => Promise<unknown>,
  assertCurrent: (job: BackgroundReviewJob) => void,
) {
  try {
    const jobs = (await hooks.status()).filter(
      (job) => job.state === "interrupted",
    );
    if (!jobs.length) {
      await vscode.window.showInformationMessage(
        "No interrupted background reviews were found.",
      );
      return;
    }
    const selected = await vscode.window.showQuickPick(
      jobs.map((job) => ({
        label: `${path.basename(job.root)} · ${job.trigger}`,
        description: `${new Date(job.createdAt).toLocaleString()} · ${job.profileId}`,
        detail: `${job.root} · ${job.id}${job.supportsRecovery ? "" : " · Service restart required"}`,
        job,
      })),
      {
        title: "Recover Background Review",
        placeHolder: "Check a saved result without running another review",
      },
    );
    if (!selected) return;
    assertCurrent(selected.job);
    const job = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Checking saved review result…",
        cancellable: false,
      },
      () => hooks.reconcile(selected.job),
    );
    if (job.state !== "finished" || !job.result?.runId) {
      await vscode.window.showInformationMessage(
        "No matching saved completion could be confirmed. The review remains interrupted; no new review was started.",
      );
      return;
    }
    await refreshHistory();
    await vscode.window.showInformationMessage(
      `Saved review recovered (${job.result.status}). Open review history to inspect the result.`,
    );
    return job;
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Review recovery did not complete: ${error instanceof Error ? error.message : "unavailable"}`,
    );
  }
}
