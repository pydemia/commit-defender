import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  contentHash,
  type LocalKeyStore,
  type LocalReviewChatExecutor,
} from "@gcr/client-core";
import { prepareStandaloneReview } from "../src/standaloneReview.js";
import { reviewChatOperation } from "../src/reviewChatSession.js";
import { ReviewChatView } from "../src/reviewChatView.js";
import type { StandaloneReviewSettings } from "../src/standaloneReviewProtocol.js";
import type {
  ReviewChatAction,
  ReviewChatResult,
} from "../src/reviewChatProtocol.js";
import { fixture } from "./helpers/review-fixture.js";
const settings: StandaloneReviewSettings = {
  mode: "standalone",
  profileId: "chat-test",
  provider: "codex",
  model: "gpt-6-astra",
  reasoningEffort: "xhigh",
  executablePath: "codex",
  workspaceTrusted: true,
  durationMs: 120000,
  excludePatterns: [],
};
const descriptor = {
  id: "fixture",
  version: "1",
  model: "gpt-6-astra",
  configHash: contentHash("chat-fixture"),
  capabilities: {
    available: true,
    sourceIsolation: "fixed-source-only" as const,
    cancellation: true,
    timeout: true,
    childProcessCleanup: true,
    outputTokenLimit: false,
  },
};
async function setup(t: test.TestContext) {
  const f = fixture();
  t.after(f.cleanup);
  f.write(
    "sum.ts",
    "export const sum = (values: number[]) => values.reduce((a,b) => a+b, 0);\n",
  );
  f.git("add", ".");
  f.git("commit", "-m", "base");
  f.write(
    "sum.ts",
    "export const sum = (values: number[]) => values.reduce((a,b) => a+b);\n",
  );
  f.git("add", ".");
  const entries = new Map<string, Buffer>();
  const keys: LocalKeyStore = {
    async read(id) {
      const v = entries.get(id);
      return v && Buffer.from(v);
    },
    async write(id, v) {
      entries.set(id, Buffer.from(v));
    },
    async remove(id) {
      entries.delete(id);
    },
  };
  let calls = 0;
  let converse: LocalReviewChatExecutor["converse"] = async (input) => {
    const read = JSON.parse(
      await input.source.execute("read_file", {
        path: "sum.ts",
        side: "source",
      }),
    );
    return {
      model: descriptor.model,
      raw: JSON.stringify({
        content: "The initial value is missing.",
        citations: [{ readId: read.readId, startLine: 1, endLine: 1 }],
      }),
    };
  };
  const executor: LocalReviewChatExecutor = {
    descriptor,
    conversationCapability: "checkpoint-tool-v1",
    async review(input) {
      const reads = await Promise.all(
        ["source", "base"].map(async (side) =>
          JSON.parse(
            await input.source.execute("read_file", { path: "sum.ts", side }),
          ),
        ),
      );
      return {
        model: descriptor.model,
        raw: JSON.stringify({
          summary: "Synthetic empty-input review",
          files: [
            {
              path: "sum.ts",
              side: "source",
              complete: true,
              summary: "Read both revisions.",
              readIds: reads.map((r) => r.readId),
            },
          ],
          findings: [],
          questions: [],
        }),
      };
    },
    async converse(input) {
      calls++;
      return converse(input);
    },
  };
  const ports = {
    dataDirectory: path.join(f.root, "data"),
    keys,
    prepareExecutor: async () => executor,
  };
  const job = await prepareStandaloneReview(
    { repoRoot: f.repo, files: ["sum.ts"], scope: "staged" },
    settings,
    new AbortController().signal,
    ports,
  );
  const result = await job.run(new AbortController().signal);
  const report = result.report.gcr!.report;
  const target = {
    repoRoot: f.repo,
    reportId: report.runId,
    mode: "standalone" as const,
  };
  const operation = (
    action: ReviewChatAction,
    next = settings,
    signal = new AbortController().signal,
  ) => reviewChatOperation(target, action, next, signal, () => {}, ports);
  return {
    f,
    target,
    operation,
    report,
    setConverse(next: typeof converse) {
      converse = next;
    },
    calls: () => calls,
  };
}
function state(value: ReviewChatResult) {
  assert.equal(value.type, "state");
  if (value.type !== "state") throw Error("fixture");
  return value.state;
}
test("a saved review opens without a model call and resumes a question across reopened workers with captured-source navigation", async (t) => {
  const f = await setup(t);
  const original = state(await f.operation({ type: "read" }));
  assert.equal(original.conversation.turns.length, 0);
  assert.equal(f.calls(), 0);
  f.setConverse(async (input) => {
    await input.questions.askUser("question-call", {
      question: "Should empty input return zero?",
      options: ["Yes", "No"],
    });
    throw Error("paused");
  });
  const pending = state(
    await f.operation({
      type: "send",
      turnId: "turn-1",
      content: "Explain empty input.",
    }),
  );
  assert.equal(pending.conversation.turns[0].status, "awaiting_input");
  f.f.write("sum.ts", "LIVE_SOURCE_CHANGED");
  f.setConverse(async (input) => {
    assert(input.prompt.includes("Yes"));
    const read = JSON.parse(
      await input.source.execute("read_file", { path: "sum.ts" }),
    );
    assert(!read.text.includes("LIVE_SOURCE_CHANGED"));
    return {
      model: descriptor.model,
      raw: JSON.stringify({
        content: "Restore an initial value.",
        citations: [{ readId: read.readId, startLine: 1, endLine: 1 }],
      }),
    };
  });
  const complete = state(
    await f.operation({
      type: "answer",
      turnId: "turn-1",
      questionId: pending.conversation.turns[0].questions[0].id,
      content: "Yes",
    }),
  );
  assert.equal(complete.conversation.turns[0].status, "completed");
  assert.equal(f.calls(), 2);
  const source = await f.operation({
    type: "source",
    turnId: "turn-1",
    citation: 0,
  });
  assert.equal(source.type, "source");
  if (source.type === "source") {
    assert(source.content.includes("values.reduce"));
    assert(!source.content.includes("LIVE_SOURCE_CHANGED"));
    assert.equal(source.line, 1);
  }
  await assert.rejects(
    f.operation({ type: "source", turnId: "turn-1", citation: 99 }),
    { code: "invalid-state" },
  );
});
test("changed model, exclusions, lower budget and untrusted workspace fail before another model call", async (t) => {
  const f = await setup(t);
  for (const change of [
    { model: "other" },
    { excludePatterns: ["sum.ts"] },
    { durationMs: 60000 },
    { workspaceTrusted: false },
  ]) {
    await assert.rejects(
      f.operation(
        { type: "send", turnId: "blocked", content: "Review" },
        { ...settings, ...change },
      ),
    );
  }
  assert.equal(f.calls(), 0);
  assert.equal(
    state(await f.operation({ type: "read" })).conversation.turns.length,
    0,
  );
});
test("a cancelled question cannot resume and a new turn can be started explicitly", async (t) => {
  const f = await setup(t);
  f.setConverse(async (input) => {
    await input.questions.askUser("q", { question: "Intent?", options: [] });
    throw Error("paused");
  });
  const pending = state(
    await f.operation({ type: "send", turnId: "turn", content: "Ask." }),
  );
  assert.equal(
    state(await f.operation({ type: "cancel", turnId: "turn" })).conversation
      .turns[0].status,
    "cancelled",
  );
  await assert.rejects(
    f.operation({
      type: "answer",
      turnId: "turn",
      questionId: pending.conversation.turns[0].questions[0].id,
      content: "Yes",
    }),
    { code: "invalid-state" },
  );
  assert.equal(f.calls(), 1);
  assert.equal(
    state(
      await f.operation({
        type: "send",
        turnId: "new-turn",
        content: "New question.",
      }),
    ).conversation.turns[1].status,
    "awaiting_input",
  );
});
test("chat view rejects stale renders, arbitrary paths and commands and escapes model/user content", async (t) => {
  const f = await setup(t);
  await f.operation({
    type: "send",
    turnId: "turn",
    content: "<img src=x onerror=alert(1)>",
  });
  const saved = state(await f.operation({ type: "read" }));
  saved.review.summary =
    "[outside](command:workbench.action.closeWindow) <script>alert(1)</script>";
  const view = new ReviewChatView(),
    rendered = view.render(saved);
  assert(!rendered.html.includes("<script>"));
  assert(!rendered.html.includes("<img"));
  assert(!rendered.html.includes('href="command:'));
  assert.equal(
    view.message({
      command: "send",
      viewId: view.id,
      revision: rendered.revision,
      content: "Hello",
    })?.command,
    "send",
  );
  assert.equal(
    view.message({
      command: "source",
      viewId: view.id,
      revision: rendered.revision,
      id: "../../secret",
    }),
    undefined,
  );
  assert.equal(
    view.message({
      command: "send",
      viewId: view.id,
      revision: rendered.revision,
      content: "Hello",
      executablePath: "evil",
    }),
    undefined,
  );
  assert.equal(
    view.message({
      command: "send",
      viewId: "old",
      revision: rendered.revision,
      content: "Hello",
    }),
    undefined,
  );
  view.render(saved);
  assert.equal(
    view.message({
      command: "send",
      viewId: view.id,
      revision: rendered.revision,
      content: "Hello",
    }),
    undefined,
  );
  assert(view.html.includes("e.isComposing"));
  assert(view.html.includes("Shift+Enter"));
});
