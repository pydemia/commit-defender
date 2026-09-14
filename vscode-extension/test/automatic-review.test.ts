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
  run?: (task: AutomaticTask<ReviewRequest>) => Promise<void>,
) {
  reset();
  const f = fixture();
  t.after(f.cleanup);
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
  const controller = new AutomaticReviews(context, {
    busy: () => false,
    debounceMs: 25,
    state: () => {},
    run: async (request, task) => {
      calls.push(request);
      await run?.(task);
    },
  });
  t.after(async () => {
    controller.dispose();
    await controller.settled();
    reset();
  });
  return {
    ...f,
    root,
    state,
    calls,
    controller,
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
test("all Save/Stage combinations are independent; workspace settings cannot grant execution", () => {
  for (const save of [false, true])
    for (const stage of [false, true]) {
      const global = { runOnSave: save, runOnStage: stage };
      const cfg = automaticSettings(
        (key) => (global as Record<string, unknown>)[key],
      );
      assert.equal(cfg.save, save);
      assert.equal(cfg.stage, stage);
      assert.equal(cfg.autoSave, false);
      assert.equal(cfg.external, false);
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
