import { parentPort, workerData } from "node:worker_threads";
import { reviewChatOperation } from "./reviewChatSession.js";
import { chatError } from "./reviewChatProtocol.js";
const port = parentPort;
if (!port) throw Error("Chat requires a worker port.");
const controller = new AbortController();
port.on("message", (message) => {
  if (message?.type === "cancel") controller.abort("cancelled");
});
port.on("close", () => controller.abort("cancelled"));
void reviewChatOperation(
  workerData.target,
  workerData.action,
  workerData.settings,
  controller.signal,
  (message) => port.postMessage({ type: "progress", message }),
)
  .then(
    (result) => port.postMessage({ type: "result", result }),
    (error) =>
      port.postMessage({ type: "failure", code: chatError(error).code }),
  )
  .finally(() => port.close());
