import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type {
  callLocalService,
  ServiceJob,
  ServiceRegistration,
} from "@gcr/client-core";
import type { SelectionStore } from "../src/centralConnection.js";
import { BackgroundHooks } from "../src/backgroundHooks.js";
import { recoverBackgroundReview } from "../src/backgroundRecovery.js";
import { ui } from "./helpers/vscode-recovery.js";

function fixture() {
  ui.reset();
  const owned = {
    root: "/fixture/repo",
    profileId: "recovery-test",
    dataDirectory: "/fixture/data",
  };
  const rows = new Map<string, unknown>([["background-hooks.v1", [owned]]]);
  const store: SelectionStore = {
    get<T>(key: string) {
      return rows.get(key) as T | undefined;
    },
    async update(key, value) {
      rows.set(key, value);
    },
  };
  const registration = {
    key: "a".repeat(64),
    revision: 1,
    triggers: ["commit"],
  } as ServiceRegistration;
  const job: ServiceJob = {
    version: 1,
    id: randomUUID(),
    repository: registration.key,
    registrationRevision: 1,
    trigger: "commit",
    payloadHash: "d".repeat(64),
    sourceHash: "b".repeat(64),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    state: "interrupted",
    owner: null,
    result: {
      exitCode: 2,
      status: "partial",
      runId: randomUUID(),
      completionUnconfirmed: true,
    },
    execution: { key: "c".repeat(64), generation: 1 },
  } as ServiceJob;
  const state = {
    recovery: true,
    resolves: true,
    refreshed: 0,
    revoked: false,
  };
  const calls: string[] = [];
  const call: typeof callLocalService = async (location, input) => {
    const request = input as Record<string, unknown>;
    assert.equal(location.profileId, owned.profileId);
    assert.equal(location.dataDirectory, owned.dataDirectory);
    calls.push(String(request.action));
    if (request.action === "registration") return registration;
    if (request.action === "status")
      return {
        features: state.recovery ? ["review-reconciliation-v1"] : [],
        jobs: [job, { ...job, id: randomUUID(), repository: "other" }],
      };
    if (request.action === "job") return request.id === job.id ? job : null;
    if (request.action === "reconcile") {
      assert.deepEqual(request, { action: "reconcile", id: job.id });
      if (state.revoked) throw Error("service-denied");
      if (state.resolves) {
        job.state = "finished";
        job.result = { ...job.result!, completionUnconfirmed: false };
      }
      return job;
    }
    throw Error("Unexpected service operation: " + request.action);
  };
  const hooks = new BackgroundHooks("/fixture/extension", store, call);
  const run = (assertCurrent = () => {}) =>
    recoverBackgroundReview(
      hooks,
      async () => {
        state.refreshed++;
      },
      assertCurrent,
    );
  return { owned, rows, registration, job, state, calls, hooks, run };
}

test("recovery selects only owned jobs and restores the original partial result", async () => {
  const f = fixture(),
    id = f.job.result!.runId;
  const recovered = await f.run();
  assert.equal(ui.choices.length, 1);
  assert.equal(recovered?.result?.runId, id);
  assert.equal(recovered?.result?.status, "partial");
  assert.equal(f.state.refreshed, 1);
  assert.deepEqual(f.calls, [
    "registration",
    "status",
    "registration",
    "status",
    "job",
    "reconcile",
  ]);
  assert.match(ui.messages[0], /recovered \(partial\)/);
});
test("cancelled selection does not request recovery or refresh history", async () => {
  const f = fixture();
  ui.choice = undefined;
  await f.run();
  assert.equal(f.state.refreshed, 0);
  assert.deepEqual(f.calls, ["registration", "status"]);
});
test("missing completion stays interrupted and does not report success", async () => {
  const f = fixture();
  f.state.resolves = false;
  assert.equal(await f.run(), undefined);
  assert.equal(f.job.state, "interrupted");
  assert.equal(f.state.refreshed, 0);
  assert.match(ui.messages[0], /remains interrupted/);
});
test("an old live service requires restart and is not stopped by recovery", async () => {
  const f = fixture();
  f.state.recovery = false;
  await f.run();
  assert.match(ui.errors[0], /active reviews finish/);
  assert(!f.calls.includes("reconcile"));
  assert(!f.calls.includes("stop"));
});
test("changing profile or workspace while picking rejects the selected review", async () => {
  const f = fixture();
  await f.run(() => {
    throw Error("Original profile no longer selected.");
  });
  assert.match(ui.errors[0], /Original profile/);
  assert.deepEqual(f.calls, ["registration", "status"]);
});
test("removed ownership and changed registration cannot recover stale selections", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => f.rows.clear(),
    (f: ReturnType<typeof fixture>) => f.registration.revision++,
    (f: ReturnType<typeof fixture>) => f.registration.triggers.splice(0),
    (f: ReturnType<typeof fixture>) => {
      f.job.repository = "foreign";
    },
  ]) {
    const f = fixture();
    ui.beforePick = () => {
      mutate(f);
    };
    await f.run();
    assert.match(ui.errors[0], /no longer authorized/);
    assert(!f.calls.includes("reconcile"));
  }
});
test("current central revocation remains a recovery error", async () => {
  const f = fixture();
  f.state.revoked = true;
  await f.run();
  assert.match(ui.errors[0], /^Commit Defender: Review recovery did not complete/);
  assert.match(ui.errors[0], /service-denied/);
  assert.equal(f.state.refreshed, 0);
  assert.equal(f.job.state, "interrupted");
});
test("another caller completing the selected job reuses the saved result", async () => {
  const f = fixture();
  ui.beforePick = () => {
    f.job.state = "finished";
  };
  const recovered = await f.run();
  assert.equal(recovered?.state, "finished");
  assert(!f.calls.includes("reconcile"));
  assert.equal(f.state.refreshed, 1);
});
test("running jobs are not offered as interrupted even with an old result", async () => {
  const f = fixture();
  f.job.state = "running";
  await f.run();
  assert.equal(ui.choices.length, 0);
  assert.match(ui.messages[0], /No interrupted/);
  assert(!f.calls.includes("reconcile"));
});
