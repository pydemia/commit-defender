/** Manual diagnostic for synthetic fixtures only. Never bundled into the extension or VSIX. */
import { parentPort, workerData } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import { localReviewResponse } from "@gcr/client-contract";
import { prepareCodexAccountExecutor } from "@gcr/client-executors";
import { prepareStandaloneReview } from "../src/standaloneReview.js";
import {
  standaloneError,
  type StandaloneReviewSettings,
} from "../src/standaloneReviewProtocol.js";
import type { PreparedExecution, ReviewRequest } from "../src/reviewBackend.js";
import type { RunResult } from "../src/types.js";

const port = parentPort!;
const input = workerData as {
  request: ReviewRequest;
  settings: StandaloneReviewSettings;
};
if (
  !path
    .basename(path.dirname(input.request.repoRoot))
    .startsWith("cd-standalone-smoke-")
)
  throw Error("Diagnostic worker requires an owned synthetic fixture.");
const controller = new AbortController();
let job: PreparedExecution<RunResult> | undefined;
let running = false;
port.on("close", () => controller.abort("cancelled"));
port.on(
  "message",
  (message: { type: string; reason?: string; aborted?: boolean }) => {
    if (message.type === "dispose" || message.type === "cancel") {
      controller.abort(message.reason ?? "cancelled");
      if (job && !running)
        void Promise.resolve(job.dispose?.()).then(() => port.close());
    } else if (message.type === "run" && job && !running) {
      running = true;
      if (message.aborted) controller.abort(message.reason ?? "cancelled");
      void job
        .run(controller.signal)
        .then(
          (result) => port.postMessage({ type: "result", result }),
          (error) =>
            port.postMessage({
              type: "failure",
              code: standaloneError(error).code,
            }),
        )
        .finally(() => port.close());
    }
  },
);
void prepareStandaloneReview(input.request, input.settings, controller.signal, {
  prepareExecutor: async (options) => {
    const executor = await prepareCodexAccountExecutor(options);
    return {
      descriptor: executor.descriptor,
      review: async (request) => {
        const reads: Array<Record<string, unknown>> = [];
        const result = await executor.review({
          ...request,
          source: {
            async execute(name, args) {
              const raw = await request.source.execute(name, args);
              if (name === "read_file") {
                const value = JSON.parse(raw);
                reads.push({
                  readId: value.readId,
                  source: value.source,
                  startLine: value.startLine,
                  endLine: value.endLine,
                  truncated: value.truncated,
                });
              }
              return raw;
            },
          },
        });
        const diagnostic: Record<string, unknown> = {
          kind: "synthetic-fixture-output-diagnostic",
          model: result.model,
          reads,
        };
        try {
          const parsed = JSON.parse(result.raw);
          diagnostic.parsed = parsed;
          try {
            localReviewResponse(parsed);
            diagnostic.shapeValid = true;
          } catch (error) {
            diagnostic.shapeValid = false;
            diagnostic.shapeError =
              error instanceof Error ? error.message : "shape-invalid";
          }
        } catch {
          diagnostic.jsonValid = false;
          diagnostic.rawBytes = Buffer.byteLength(result.raw);
        }
        fs.writeFileSync(
          path.join(input.request.repoRoot, ".cd-diagnostic.json"),
          JSON.stringify(diagnostic),
          { flag: "wx", mode: 0o600 },
        );
        return result;
      },
    };
  },
}).then(
  (prepared) => {
    job = prepared;
    if (controller.signal.aborted) {
      void Promise.resolve(job.dispose?.()).then(() => port.close());
      return;
    }
    port.postMessage({
      type: "prepared",
      key: job.key,
      backendId: job.backendId,
    });
  },
  (error) => {
    port.postMessage({ type: "failure", code: standaloneError(error).code });
    port.close();
  },
);
