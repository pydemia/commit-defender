import { parentPort, workerData } from "node:worker_threads";
import { prepareStandaloneReview } from "./standaloneReview.js";
import {
  standaloneError,
  type StandaloneReviewSettings,
} from "./standaloneReviewProtocol.js";
import type { PreparedExecution, ReviewRequest } from "./reviewBackend.js";
import type { RunResult } from "./types.js";

const port = parentPort;
if (!port) throw new Error("Standalone review requires a worker port.");
const input = workerData as {
  request: ReviewRequest;
  settings: StandaloneReviewSettings;
};
const controller = new AbortController();
let job: PreparedExecution<RunResult> | undefined;
let running = false;
let closed = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const close = async () => {
  if (closed || running) return;
  closed = true;
  if (idleTimer) clearTimeout(idleTimer);
  await job?.dispose?.();
  port.close();
};
port.on("close", () => controller.abort("disposed"));
port.on(
  "message",
  (message: { type: string; reason?: string; aborted?: boolean }) => {
    if (message.type === "cancel" || message.type === "dispose") {
      controller.abort(message.reason ?? "cancelled");
      // Preparation may still own bounded child processes. Let its finally blocks finish.
      if (job && !running) void close();
      return;
    }
    if (message.type !== "run" || !job || running || closed) return;
    if (idleTimer) clearTimeout(idleTimer);
    if (message.aborted) controller.abort(message.reason ?? "cancelled");
    running = true;
    void job
      .run(controller.signal, (index, count, file) => {
        port.postMessage({ type: "progress", index, count, file });
      })
      .then(
        (result) => {
          port.postMessage({ type: "result", result });
        },
        (error) => {
          port.postMessage({
            type: "failure",
            code: standaloneError(error).code,
          });
        },
      )
      .finally(async () => {
        running = false;
        await close();
      });
  },
);

void prepareStandaloneReview(
  input.request,
  input.settings,
  controller.signal,
).then(
  async (prepared) => {
    job = prepared;
    if (controller.signal.aborted) {
      await close();
      return;
    }
    // Idle preparations own no executor children; release keys/snapshot if the caller disappears.
    idleTimer = setTimeout(() => void close(), 60_000);
    port.postMessage({
      type: "prepared",
      key: prepared.key,
      backendId: prepared.backendId,
    });
  },
  async (error) => {
    port.postMessage({ type: "failure", code: standaloneError(error).code });
    await close();
  },
);
