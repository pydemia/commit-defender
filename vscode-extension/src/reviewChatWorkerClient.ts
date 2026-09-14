import { Worker } from "node:worker_threads";
import type { StandaloneReviewSettings } from "./standaloneReviewProtocol.js";
import {
  ReviewChatError,
  type ReviewChatTarget,
  type ReviewChatAction,
  type ReviewChatResult,
} from "./reviewChatProtocol.js";
/** A result is delivered only after the worker exits and releases keys and children. */
export function runReviewChatWorker(
  workerFile: string,
  target: ReviewChatTarget,
  action: ReviewChatAction,
  settings: StandaloneReviewSettings,
  signal: AbortSignal,
  progress: (message: string) => void = () => {},
): Promise<ReviewChatResult> {
  if (signal.aborted) return Promise.reject(new ReviewChatError("cancelled"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, {
      workerData: { target, action, settings },
    });
    let result: ReviewChatResult | undefined,
      failure: ReviewChatError | undefined;
    const abort = () => worker.postMessage({ type: "cancel" });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    worker.on("message", (message) => {
      if (message?.type === "result") result = message.result;
      else if (message?.type === "failure")
        failure = new ReviewChatError(message.code);
      else if (
        message?.type === "progress" &&
        typeof message.message === "string" &&
        !signal.aborted
      )
        progress(message.message);
    });
    worker.on("error", () => {
      failure = new ReviewChatError("worker-failed");
    });
    worker.on("exit", (code) => {
      signal.removeEventListener("abort", abort);
      if (code === 0 && result && !failure) resolve(result);
      else
        reject(
          failure ??
            new ReviewChatError(signal.aborted ? "cancelled" : "worker-failed"),
        );
    });
  });
}
