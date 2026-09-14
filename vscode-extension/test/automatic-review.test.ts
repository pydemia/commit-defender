import assert from "node:assert/strict";
import path from "node:path";
import { realpathSync, writeFileSync } from "node:fs";
import test from "node:test";
import type * as vscode from "vscode";
import { AutomaticReviews } from "../src/automaticReviews.js";
import {
  automaticSettings,
  automaticSelectionKey,
} from "../src/automaticSettings.js";
import { knowledgeScope } from "../src/localKnowledge.js";
import { fixture } from "./helpers/review-fixture.js";
import {
  reset,
  values,
  workspace,
  watchers,
  events,
  Uri,
} from "./helpers/vscode-automatic.js";
import type { AutomaticTask } from "@gcr/client-core";
import type { ReviewRequest } from "../src/reviewBackend.js";
import { AutomaticStageCheckpoint } from "../src/automaticStageCheckpoint.js";
import { contentHash, observeAutomaticRepository } from "@gcr/client-core";
import type { LocalReviewExecutor } from "@gcr/client-core";
import { prepareStandaloneReview } from "../src/standaloneReview.js";
async function until(check: () => boolean, timeout = 12000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw Error("Automatic event did not settle");
    await new Promise((r) => setTimeout(r, 20));
  }
}
function setup(
  t: test.TestContext,
  settings: Record<string, unknown> = {},
  run?: (
    task: AutomaticTask<ReviewRequest>,
  ) => Promise<void | { completionConfirmed?: boolean }>,
  bridge: Partial<
    Pick<
      ConstructorParameters<typeof AutomaticReviews>[1],
      "configureHooks" | "backgroundStage" | "backgroundSave"
    >
  > = {},
) {
  reset();
  const f = fixture();
  const root = realpathSync(f.repo);
  f.write("a.ts", "export const a=1;\n");
  f.git("add", ".");
  f.git("commit", "-m", "base");
  values.global = { localProfile: "auto-test", ...settings };
  workspace.workspaceFolders = [{ uri: Uri.file(root) }];
  const state = new Map<string, unknown>();
  const context = {
    globalState: {
      get: (key: string) => state.get(key),
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
    },
  } as unknown as vscode.ExtensionContext;
  const calls: ReviewRequest[] = [];
  const runtime = { busy: false };
  const transitions: Array<{ phase: string; reason?: string }> = [];
  const ports = {
    ...bridge,
    busy: () => runtime.busy,
    debounceMs: 25,
    storage: {
      dataDirectory: path.join(f.root, "automatic-state"),
      keys: (() => {
        const keys = new Map<string, Buffer>();
        return {
          read: async (id: string) =>
            keys.has(id) ? Buffer.from(keys.get(id)!) : undefined,
          write: async (id: string, value: Buffer) => {
            keys.set(id, Buffer.from(value));
          },
          remove: async (id: string) => {
            keys.delete(id);
          },
        };
      })(),
    },
    state: (value: { phase: string; reason?: string }) => {
      transitions.push(value);
    },
    run: async (request: ReviewRequest, task: AutomaticTask<ReviewRequest>) => {
      calls.push(request);
      return (await run?.(task)) ?? { completionConfirmed: true };
    },
  };
  let controller = new AutomaticReviews(context, ports);
  t.after(async () => {
    controller.dispose();
    await controller.settled();
    f.cleanup();
    reset();
  });
  return {
    ...f,
    root,
    state,
    calls,
    runtime,
    transitions,
    storage: ports.storage,
    get controller() {
      return controller;
    },
    restart: async (whileClosed?: () => void) => {
      controller.dispose();
      await controller.settled();
      whileClosed?.();
      controller = new AutomaticReviews(context, ports);
      await controller.refresh();
    },
    save: (file: string, reason = 1) => {
      const document = { uri: Uri.file(path.join(root, file)), isDirty: false };
      events.willSave.fire({ document, reason });
      events.didSave.fire(document);
    },
    stageEvent: () => {
      for (const watcher of watchers)
        if (!watcher.disposed && watcher.pattern.pattern === "index")
          watcher.change.fire(
            Uri.file(path.join(watcher.pattern.baseUri.fsPath, "index")),
          );
    },
  };
}
test("all sixteen trigger settings are independent and workspace values cannot grant execution", () => {
  for (let mask = 0; mask < 16; mask++) {
    const fields = ["save", "stage", "commit", "push"] as const;
    const settings = ["runOnSave", "runOnStage", "runOnCommit", "runOnPush"];
    const global = Object.fromEntries(
      settings.map((name, bit) => [name, !!(mask & (1 << bit))]),
    );
    const cfg = automaticSettings((key) => global[key]);
    fields.forEach((field, bit) =>
      assert.equal(cfg[field], !!(mask & (1 << bit))),
    );
    assert.equal(cfg.autoSave, false);
    assert.equal(cfg.external, false);
    const paused = automaticSettings(
      (key) => (key === "automaticReviewsPaused" ? true : global[key]),
      { version: 1, paused: false },
    );
    assert.equal(paused.paused, true);
  }
  assert.equal(automaticSettings(() => undefined).save, false);
  assert.equal(
    automaticSettings(
      (k) => (k === "automaticReviewsPaused" ? true : undefined),
      { version: 1, save: true, paused: false },
    ).paused,
    true,
  );
  assert.equal(
    automaticSettings(() => undefined, { version: 1, save: "true" }).paused,
    true,
  );
});
test("manual Save emits the exact saved hash; Auto Save, typing and identical saves do not add calls", async (t) => {
  const f = setup(t, { runOnSave: true });
  await f.controller.refresh();
  f.write("a.ts", "export const a=2;\n");
  f.save("a.ts");
  await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].automatic?.reason, "save");
  assert.equal(f.calls[0].scope, "selection");
  assert.match(f.calls[0].automatic?.files?.["a.ts"] ?? "", /^[a-f0-9]{64}$/);
  f.save("a.ts");
  f.write("a.ts", "export const a=3;\n");
  f.save("a.ts", 2);
  events.change.fire({
    document: { uri: Uri.file(path.join(f.root, "a.ts")), isDirty: true },
    contentChanges: [{}],
  });
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(f.calls.length, 1);
});
test("stage watches actual index input and ignores a file being unstaged and a no-op index event", async (t) => {
  const f = setup(t, { runOnStage: true });
  await f.controller.refresh();
  f.write("a.ts", "export const a=2;\n");
  f.git("add", "a.ts");
  f.stageEvent();
  await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].automatic?.reason, "stage");
  assert.equal(f.calls[0].scope, "staged");
  f.stageEvent();
  await new Promise((r) => setTimeout(r, 350));
  f.git("restore", "--staged", "a.ts");
  f.stageEvent();
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(f.calls.length, 1);
});
test("workspace grants are ignored, private worktree override works, and pause removes watchers", async (t) => {
  const f = setup(t);
  values.repository = { runOnSave: true, runOnStage: true };
  await f.controller.refresh();
  f.write("a.ts", "export const a=2;\n");
  f.save("a.ts");
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(f.calls.length, 0);
  const scope = knowledgeScope({
    repoRoot: f.root,
    profileId: "auto-test",
    scope: "repository",
  });
  f.state.set(automaticSelectionKey(scope), { version: 1, save: true });
  await f.controller.refresh();
  f.save("a.ts");
  await until(() => f.calls.length === 1);
  values.global.automaticReviewsPaused = true;
  await f.controller.refresh();
  assert(watchers.filter((w) => !w.disposed).length === 0);
  f.write("a.ts", "export const a=3;\n");
  f.save("a.ts");
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(f.calls.length, 1);
});
test("external watching cannot turn a rejected Auto Save into an authorized review", async (t) => {
  const f = setup(t, {
    runOnSave: true,
    reviewExternalChanges: true,
    reviewAutoSaves: false,
  });
  await f.controller.refresh();
  const uri = Uri.file(path.join(f.root, "a.ts"));
  f.write("a.ts", "export const a=2;\n");
  f.save("a.ts", 2);
  const external = watchers.find(
    (w) => !w.disposed && w.pattern.pattern === "**/*",
  )!;
  assert(external);
  external.change.fire(uri);
  await new Promise((r) => setTimeout(r, 3700));
  assert.equal(f.calls.length, 0);
  f.write("a.ts", "export const external=3;\n");
  external.change.fire(uri);
  await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].automatic?.reason, "save");
});
test("background Save forwards editor provenance once and never falls back to a foreground model", async (t) => {
  const forwarded: Array<{
    file: string;
    hash?: string | null;
    reason: string;
  }> = [];
  const f = setup(
    t,
    { runOnSave: true, reviewAutoSaves: false, reviewExternalChanges: true },
    undefined,
    {
      configureHooks: async () => {},
      backgroundSave: async (_root, input) => {
        forwarded.push(input);
        return { status: input.reason === "auto" ? "suppressed" : "pending" };
      },
    },
  );
  await f.controller.refresh();
  f.write("a.ts", "export const auto=2;\n");
  f.save("a.ts", 2);
  await f.controller.settled();
  const watcher = watchers.find(
    (w) => !w.disposed && w.pattern.pattern === "**/*",
  )!;
  watcher.change.fire(Uri.file(path.join(f.root, "a.ts")));
  await new Promise((resolve) => setTimeout(resolve, 3700));
  assert.deepEqual(
    forwarded.map((event) => event.reason),
    ["auto"],
  );
  f.write("a.ts", "export const manual=3;\n");
  f.save("a.ts", 1);
  await f.controller.settled();
  events.change.fire({
    document: { uri: Uri.file(path.join(f.root, "a.ts")), isDirty: true },
    contentChanges: [{}],
  });
  await f.controller.settled();
  assert.deepEqual(
    forwarded.map((event) => event.reason),
    ["auto", "manual", "dirty"],
  );
  assert.equal(f.calls.length, 0);
});
test("background Stage owns execution and an unavailable Save service does not start a replacement model", async (t) => {
  const f = setup(t, { runOnSave: true, runOnStage: true }, undefined, {
    configureHooks: async () => {},
    backgroundStage: () => true,
    backgroundSave: async () => {
      throw Error("submission outcome unknown");
    },
  });
  await f.controller.refresh();
  f.write("a.ts", "export const stage=2;\n");
  f.git("add", "a.ts");
  f.stageEvent();
  f.save("a.ts");
  await f.controller.settled();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(f.calls.length, 0);
  assert(
    f.transitions.some(
      (state) => state.reason === "background-save-unavailable",
    ),
  );
});
test("multiple workspace roots include the linked worktree index and keep its paths separate", async (t) => {
  const f = setup(t, { runOnStage: true });
  const other = path.join(f.root, "..", "linked");
  f.git("worktree", "add", "-b", "linked", other);
  workspace.workspaceFolders.push({ uri: Uri.file(realpathSync(other)) });
  await f.controller.refresh();
  assert.equal(
    watchers.filter((w) => !w.disposed && w.pattern.pattern === "index").length,
    2,
  );
  writeFileSync(path.join(other, "a.ts"), "export const linked=2;\n");
  f.git("-C", other, "add", "a.ts");
  f.stageEvent();
  await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].repoRoot, realpathSync(other));
  assert.deepEqual(f.calls[0].files, ["a.ts"]);
});
test("disabling the trigger cancels active automatic work and fences its late result", async (t) => {
  let task: AutomaticTask<ReviewRequest> | undefined, release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  t.after(() => release());
  const f = setup(t, { runOnSave: true }, async (current) => {
    task = current;
    await gate;
  });
  await f.controller.refresh();
  f.write("a.ts", "export const a=2;\n");
  f.save("a.ts");
  await until(() => !!task);
  values.global.runOnSave = false;
  await f.controller.refresh();
  assert.equal(task!.signal.aborted, true);
  assert.equal(task!.isCurrent(), false);
  release();
  await f.controller.settled();
});

test("reopening the host catches a stage made while closed and remembers its acknowledgement", async (t) => {
  const f = setup(t, { runOnStage: true });
  await f.controller.refresh();
  await f.restart(() => {
    f.write("a.ts", "export const closed=2;\n");
    f.git("add", "a.ts");
  });
  await until(() => f.calls.length === 1);
  await f.controller.settled();
  const observed = await observeAutomaticRepository(f.root);
  assert.equal(f.calls[0].automatic?.indexFingerprint, observed.fingerprint);
  await f.restart();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(f.calls.length, 1);
});

test("an observed stage survives host shutdown while manual work holds the scheduler", async (t) => {
  const f = setup(t, { runOnStage: true });
  await f.controller.refresh();
  f.runtime.busy = true;
  f.write("a.ts", "export const queued=2;\n");
  f.git("add", "a.ts");
  f.stageEvent();
  await until(() =>
    f.transitions.some((s) => s.phase === "waiting" && s.reason === "debounce"),
  );
  assert.equal(f.calls.length, 0);
  await f.restart(() => {
    f.runtime.busy = false;
  });
  await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].automatic?.reason, "stage");
});

test("whole-file unstage while the host is closed does not turn the remaining index into new work", async (t) => {
  const f = setup(t, { runOnStage: true });
  await f.controller.refresh();
  f.write("a.ts", "export const changed=2;\n");
  f.write("b.ts", "export const added=2;\n");
  f.git("add", ".");
  f.stageEvent();
  await until(() => f.calls.length === 1);
  await f.controller.settled();
  await f.restart(() => {
    f.git("restore", "--staged", "a.ts");
  });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(f.calls.length, 1);
});

test("window focus rechecks a missed index event without synthesizing a Save", async (t) => {
  const f = setup(t, { runOnStage: true, runOnSave: true });
  await f.controller.refresh();
  f.write("a.ts", "export const missed=2;\n");
  f.git("add", "a.ts");
  events.focus.fire({ focused: true });
  await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].automatic?.reason, "stage");
  await f.controller.settled();
  events.focus.fire({ focused: true });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(f.calls.length, 1);
});

test("disabling Stage discards pending automatic work and does not revive it after re-enabling", async (t) => {
  const f = setup(t, { runOnStage: true });
  await f.controller.refresh();
  f.runtime.busy = true;
  f.write("a.ts", "export const queued=2;\n");
  f.git("add", "a.ts");
  f.stageEvent();
  await until(() =>
    f.transitions.some((s) => s.phase === "waiting" && s.reason === "debounce"),
  );
  values.global.runOnStage = false;
  await f.controller.refresh();
  await f.restart(() => {
    f.runtime.busy = false;
  });
  values.global.runOnStage = true;
  await f.controller.refresh();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(f.calls.length, 0);
  f.write("a.ts", "export const newlyStaged=3;\n");
  f.git("add", "a.ts");
  f.stageEvent();
  await until(() => f.calls.length === 1);
});

test("an old acknowledgement cannot clear a newer pending index observation", async (t) => {
  const f = setup(t);
  await f.controller.refresh();
  const journal = new AutomaticStageCheckpoint(f.storage),
    selection = contentHash("explicit-test-stage-selection");
  const before = await observeAutomaticRepository(f.root);
  assert.equal(
    await journal.observe(before, "journal-test", selection, true),
    false,
  );
  f.write("a.ts", "export const first=2;\n");
  f.git("add", "a.ts");
  const first = await observeAutomaticRepository(f.root);
  assert.equal(
    await journal.observe(first, "journal-test", selection, true),
    true,
  );
  f.write("a.ts", "export const second=3;\n");
  f.git("add", "a.ts");
  const second = await observeAutomaticRepository(f.root);
  assert.equal(
    await journal.observe(second, "journal-test", selection, true),
    true,
  );
  await journal.acknowledge(
    f.root,
    "journal-test",
    selection,
    first.fingerprint,
  );
  const reopened = new AutomaticStageCheckpoint(f.storage);
  assert.equal(
    await reopened.observe(second, "journal-test", selection, true),
    true,
  );
  await reopened.acknowledge(
    f.root,
    "journal-test",
    selection,
    second.fingerprint,
  );
  assert.equal(
    await journal.observe(second, "journal-test", selection, true),
    false,
  );
  assert.equal(
    await journal.observe(first, "other-profile", selection, true),
    false,
  );
});

test("restart after acknowledgement failure reuses the encrypted report through the real review broker", async (t) => {
  let modelCalls = 0,
    failAcknowledgement = true;
  const runIds: string[] = [];
  const acknowledge = AutomaticStageCheckpoint.prototype.acknowledge;
  t.mock.method(
    AutomaticStageCheckpoint.prototype,
    "acknowledge",
    async function (
      this: AutomaticStageCheckpoint,
      ...args: Parameters<typeof acknowledge>
    ) {
      if (failAcknowledgement) {
        failAcknowledgement = false;
        throw Error("Injected checkpoint write failure after saved review");
      }
      return acknowledge.apply(this, args);
    },
  );
  const descriptor: LocalReviewExecutor["descriptor"] = {
    id: "fixture",
    version: "1",
    model: "gpt-6-astra",
    configHash: contentHash("stage-catchup-test"),
    capabilities: {
      available: true,
      sourceIsolation: "fixed-source-only",
      cancellation: true,
      timeout: true,
      childProcessCleanup: true,
      outputTokenLimit: false,
    },
  };
  const f = setup(t, { runOnStage: true }, async (task) => {
    const prepared = await prepareStandaloneReview(
      task.value,
      {
        mode: "standalone",
        profileId: "auto-test",
        provider: "codex",
        model: "gpt-6-astra",
        reasoningEffort: "xhigh",
        executablePath: "codex",
        workspaceTrusted: true,
        durationMs: 120000,
        excludePatterns: [],
      },
      task.signal,
      {
        ...f.storage,
        prepareExecutor: async () => ({
          descriptor,
          review: async (input) => {
            modelCalls++;
            const reads = await Promise.all(
              ["source", "base"].map(async (side) =>
                JSON.parse(
                  await input.source.execute("read_file", {
                    path: "a.ts",
                    side,
                  }),
                ),
              ),
            );
            return {
              model: descriptor.model,
              raw: JSON.stringify({
                summary: "Synthetic restart review",
                files: [
                  {
                    path: "a.ts",
                    side: "source",
                    complete: true,
                    summary: "Read exact source and base",
                    readIds: reads.map((r) => r.readId),
                  },
                ],
                findings: [],
                questions: [],
              }),
            };
          },
        }),
      },
    );
    try {
      const result = await prepared.run(task.signal);
      assert.equal(result.reviewCompletionConfirmed, true);
      runIds.push(result.report.gcr!.report.runId);
      return { completionConfirmed: result.reviewCompletionConfirmed };
    } finally {
      await prepared.dispose?.();
    }
  });
  await f.controller.refresh();
  f.write("a.ts", "export const changed=2;\n");
  f.git("add", "a.ts");
  f.stageEvent();
  await until(() => f.transitions.some((s) => s.phase === "failed"));
  assert.equal(modelCalls, 1);
  assert.equal(runIds.length, 1);
  await f.restart();
  await until(() => runIds.length === 2);
  await f.controller.settled();
  assert.equal(modelCalls, 1);
  assert.equal(runIds[0], runIds[1]);
  await f.restart();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(runIds.length, 2);
});

test("unconfirmed completion keeps Stage pending across restart", async (t) => {
  let confirmed = false;
  const f = setup(t, { runOnStage: true }, async () => ({
    completionConfirmed: confirmed,
  }));
  await f.controller.refresh();
  f.write("a.ts", "export const changed=2;\n");
  f.git("add", "a.ts");
  f.stageEvent();
  await until(() => f.transitions.some((s) => s.phase === "failed"));
  await f.restart(() => {
    confirmed = true;
  });
  await until(() => f.calls.length === 2);
  await f.controller.settled();
  await f.restart();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(f.calls.length, 2);
});
