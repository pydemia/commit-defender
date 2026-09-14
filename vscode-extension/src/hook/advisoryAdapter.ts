import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import type { ManagedHookState } from "./managedHooks.js";

/** Runs from a private immutable copy, independently of the extension installation. */
export async function advisoryHook(
  stateFile: string,
  hook: string,
  original: string,
  args: string[],
): Promise<number> {
  let spool: string | undefined;
  let input: number | undefined;
  const originalRun = () => {
    try {
      fs.accessSync(original, fs.constants.X_OK);
    } catch {
      return 0;
    }
    const result = spawnSync(original, args, {
      stdio: [input ?? "inherit", "inherit", "inherit"],
    });
    if (result.signal) {
      process.kill(process.pid, result.signal);
      return 128;
    }
    return result.status ?? 127;
  };
  try {
    // Only pre-push needs stdin twice; preserve every byte for the original hook.
    if (hook === "pre-push") {
      spool = path.join(path.dirname(stateFile), `stdin-${randomUUID()}`);
      const fd = fs.openSync(spool, "wx", 0o600);
      try {
        for await (const chunk of process.stdin)
          fs.writeSync(fd, Buffer.from(chunk));
      } finally {
        fs.closeSync(fd);
      }
      input = fs.openSync(spool, "r");
    }
    const code = originalRun();
    if (input !== undefined) {
      fs.closeSync(input);
      input = undefined;
    }
    if (code !== 0) return code;
    try {
      const state = JSON.parse(
        fs.readFileSync(stateFile, "utf8"),
      ) as ManagedHookState;
      const root = fs.realpathSync(
        execFileSync("git", ["rev-parse", "--show-toplevel"], {
          encoding: "utf8",
          stdio: "pipe",
        }).trim(),
      );
      const route = state.routes[root];
      if (
        !route ||
        !route.triggers.includes(hook === "pre-push" ? "push" : "commit")
      )
        return 0;
      const requestId = randomUUID();
      const common = [
        "--cwd",
        root,
        "--profile",
        route.profileId,
        "--data-dir",
        route.dataDirectory,
      ];
      const args = [
        route.cli,
        hook === "pre-push" ? "enqueue-push" : "enqueue",
        ...common,
        "--request-id",
        requestId,
        ...(hook === "pre-commit" ? ["--trigger", "commit"] : []),
      ];
      if (spool) input = fs.openSync(spool, "r");
      const result = spawnSync(route.node, args, {
        encoding: "utf8",
        timeout: 45000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: [input ?? "ignore", "pipe", "pipe"],
      });
      if (input !== undefined) {
        fs.closeSync(input);
        input = undefined;
      }
      if (result.status !== 0) {
        process.stderr.write(
          `Commit Defender: review enqueue unconfirmed (${requestId}); Git continues. Inspect service status before retrying.\n`,
        );
        return 0;
      }
      const value = JSON.parse(result.stdout);
      const receipts = value.receipt
        ? [value.receipt]
        : (value.refs ?? []).flatMap((ref: { receipt?: unknown }) =>
            ref.receipt ? [ref.receipt] : [],
          );
      for (const receipt of receipts) {
        process.stderr.write(
          `Commit Defender: review queued ${receipt.id}; completion is separate from Git.\n`,
        );
        const deadline = Date.now() + route.waitMs;
        while (Date.now() < deadline) {
          const status = spawnSync(
            route.node,
            [route.cli, "service", "job", "--id", receipt.id, ...common],
            {
              encoding: "utf8",
              timeout: Math.min(5000, Math.max(1, deadline - Date.now())),
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          if (status.status !== 0) break;
          const job = JSON.parse(status.stdout);
          if (!["queued", "running"].includes(job?.state)) {
            process.stderr.write(
              `Commit Defender: review ${job.result?.status ?? job.state}${job.result?.runId ? ` (${job.result.runId})` : ""}; Git policy unchanged.\n`,
            );
            break;
          }
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.min(200, Math.max(0, deadline - Date.now())),
            ),
          );
        }
      }
    } catch {
      process.stderr.write(
        "Commit Defender: automatic review unavailable; Git continues.\n",
      );
    }
    return 0;
  } finally {
    if (input !== undefined) fs.closeSync(input);
    if (spool) fs.rmSync(spool, { force: true });
  }
}
