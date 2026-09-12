import { Worker } from "node:worker_threads";
import type { PreparedExecution, ReviewRequest } from "./reviewBackend.js";
import type { ProgressCb } from "./ai/reviewer.js";
import type { RunResult } from "./types.js";
import {
  StandaloneReviewError,
  type StandaloneReviewSettings,
} from "./standaloneReviewProtocol.js";

/** Main-thread bridge. Worker exit, rather than result delivery, acknowledges resource cleanup. */
export function prepareStandaloneWorker(
  workerFile: string,
  request: ReviewRequest,
  settings: StandaloneReviewSettings,
  preparationSignal: AbortSignal,
): Promise<PreparedExecution<RunResult>> {
  if (preparationSignal.aborted)
    return Promise.reject(new StandaloneReviewError("cancelled"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, {
      workerData: { request, settings },
    });
    let prepared = false;
    let started = false;
    let disposed = false;
    let result: RunResult | undefined;
    let failure: StandaloneReviewError | undefined;
    let settleRun: ((value: RunResult) => void) | undefined;
    let rejectRun: ((error: Error) => void) | undefined;
    let progress: ProgressCb | undefined;
    let removeRunAbort: (() => void) | undefined;
    let acknowledgeExit!: () => void;
    const exited = new Promise<void>((done) => {
      acknowledgeExit = done;
    });
    const cancel = (signal: AbortSignal) =>
      worker.postMessage({
        type: "cancel",
        reason: signal.reason === "timeout" ? "timeout" : "cancelled",
      });
    const onPreparationAbort = () => cancel(preparationSignal);
    preparationSignal.addEventListener("abort", onPreparationAbort, {
      once: true,
    });
    worker.on("error", () => {
      failure = new StandaloneReviewError("worker-failed");
    });
    worker.on("exit", () => {
      disposed = true;
      preparationSignal.removeEventListener("abort", onPreparationAbort);
      removeRunAbort?.();
      acknowledgeExit();
      const error =
        failure ??
        new StandaloneReviewError(
          preparationSignal.aborted
            ? preparationSignal.reason === "timeout"
              ? "timeout"
              : "cancelled"
            : "worker-failed",
        );
      if (!prepared) reject(error);
      else if (result && !failure) settleRun?.(result);
      else rejectRun?.(error);
    });
    worker.on("message", (message) => {
      switch (message.type) {
        case "prepared":
          if (prepared) return;
          prepared = true;
          resolve({
            backendId: message.backendId,
            key: message.key,
            async dispose() {
              if (!disposed) {
                worker.postMessage({ type: "dispose" });
                await exited;
              }
            },
            run(signal, notify) {
              if (started || disposed)
                return Promise.reject(new StandaloneReviewError("disposed"));
              started = true;
              progress = notify;
              preparationSignal.removeEventListener(
                "abort",
                onPreparationAbort,
              );
              const abort = () => cancel(signal);
              signal.addEventListener("abort", abort, { once: true });
              removeRunAbort = () => signal.removeEventListener("abort", abort);
              return new Promise<RunResult>((done, fail) => {
                settleRun = done;
                rejectRun = fail;
                // Even a pre-aborted admitted run produces its core cancelled report/history.
                worker.postMessage({
                  type: "run",
                  aborted: signal.aborted,
                  reason: signal.reason === "timeout" ? "timeout" : "cancelled",
                });
              });
            },
          });
          break;
        case "progress":
          progress?.(message.index, message.count, message.file);
          break;
        case "result":
          result = message.result as RunResult;
          break;
        case "failure":
          failure = new StandaloneReviewError(message.code);
          break;
      }
    });
  });
}
