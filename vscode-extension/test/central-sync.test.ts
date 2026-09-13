import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { contentHash, KnowledgeSyncError } from "@gcr/client-core";
import type { LocalScope } from "@gcr/client-contract";
import { CentralSynchronization } from "../src/centralSynchronization.js";
const scope = (profileId: string): LocalScope => ({
  kind: "repository",
  profileId,
  repositoryKey: contentHash("repository"),
  worktreeKey: contentHash("worktree"),
});
const selected = {
  version: 1 as const,
  mode: "centralized" as const,
  connectionId: "a".repeat(64),
  freshness: "online" as const,
};
test("no selection, standalone and explicit offline mode do not open a connection", async () => {
  let calls = 0;
  const host = new CentralSynchronization({
    synchronize: async () => {
      calls++;
    },
  });
  host.reconcile([
    { scope: scope("default") },
    {
      scope: scope("standalone"),
      selection: { version: 1, mode: "standalone" },
    },
    {
      scope: scope("offline"),
      selection: { ...selected, freshness: "offline" },
    },
  ]);
  host.wake();
  await delay(20);
  assert.equal(calls, 0);
  host.stop();
});
test("isolates profiles, deduplicates roots, and cancels only deselected scopes", async () => {
  const requests: Array<{ profile: string; signal: AbortSignal }> = [];
  const host = new CentralSynchronization({
    synchronize: async (s, _id, signal) => {
      requests.push({ profile: s.profileId, signal });
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
  });
  const alice = { scope: scope("alice"), selection: selected };
  const bob = { scope: scope("bob"), selection: selected };
  try {
    host.reconcile([alice, alice, bob]);
    await delay(20);
    assert.deepEqual(requests.map((r) => r.profile).sort(), ["alice", "bob"]);
    host.reconcile([bob]);
    await delay(20);
    assert.equal(
      requests.find((r) => r.profile === "alice")!.signal.aborted,
      true,
    );
    assert.equal(
      requests.find((r) => r.profile === "bob")!.signal.aborted,
      false,
    );
    host.wake();
    assert.equal(requests.length, 2);
    host.reconcile([]); // Untrusted or closed workspace supplies no targets.
    await host.settled();
    assert(requests.every((r) => r.signal.aborted));
  } finally {
    host.stop();
    await host.settled();
  }
});
test("focus and discovery do not restart revoked connections, but explicit reselection can", async () => {
  let calls = 0;
  const host = new CentralSynchronization({
    synchronize: async () => {
      calls++;
      throw new KnowledgeSyncError("revoked", "Revoked");
    },
  });
  const target = { scope: scope("alice"), selection: selected };
  try {
    host.reconcile([target]);
    await delay(20);
    host.reconcile([target]);
    host.wake();
    await delay(20);
    assert.equal(calls, 1);
    host.reconcile([]);
    host.reconcile([target]);
    await delay(20);
    assert.equal(calls, 2);
  } finally {
    host.stop();
    await host.settled();
  }
});
