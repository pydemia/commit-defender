import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { contentHash, type LocalReviewExecutor } from "@gcr/client-core";
import type {
  CentralKnowledgeBundle,
  ReviewSubmissionStatus,
} from "@gcr/client-contract";
import { submissionFollowupSummary } from "../src/reviewSubmissionStatus.js";
import { ReviewSubmissionSession } from "../src/reviewSubmissionSession.js";
import { ReviewSubmissionView } from "../src/reviewSubmissionView.js";
import { prepareStandaloneReview } from "../src/standaloneReview.js";
import { knowledgeScope, withLocalKnowledge } from "../src/localKnowledge.js";
import { withCentralConnection } from "../src/centralConnection.js";
import { fixture } from "./helpers/review-fixture.js";
import { centralFixture } from "./helpers/central-fixture.js";
const signal = () => new AbortController().signal;
async function setup(
  t: test.TestContext,
  mode: "standalone" | "centralized" = "standalone",
) {
  const f = fixture();
  f.write("sum.ts", "export const sum = (a: number, b: number) => a + b;\n");
  f.git("add", ".");
  f.git("commit", "-m", "base");
  f.write("sum.ts", "export const sum = (a: number, b: number) => a - b;\n");
  f.git("add", ".");
  const central = await centralFixture(f.root);
  const ports = {
    dataDirectory: path.join(f.root, "data"),
    keys: central.keys,
    credentials: central.credentials,
  };
  const profileId = "cd-submission-test";
  const scope = knowledgeScope({
    repoRoot: f.repo,
    profileId,
    scope: "repository",
  });
  const connection = await withCentralConnection(
    scope,
    (manager) =>
      manager.connect(central.config, central.secret, "commit-defender"),
    ports,
  );
  let modelCalls = 0;
  const executor: LocalReviewExecutor = {
    descriptor: {
      id: "fixture",
      version: "1",
      model: "gpt-6-astra",
      configHash: contentHash("submission-test"),
      capabilities: {
        available: true,
        sourceIsolation: "fixed-source-only",
        cancellation: true,
        timeout: true,
        childProcessCleanup: true,
        outputTokenLimit: false,
      },
    },
    async review(input) {
      modelCalls++;
      const reads = await Promise.all(
        ["source", "base"].map((side) =>
          input.source
            .execute("read_file", { path: "sum.ts", side })
            .then(JSON.parse),
        ),
      );
      return {
        model: "gpt-6-astra",
        raw: JSON.stringify({
          summary: "PRIVATE_REVIEW_PROSE",
          files: [
            {
              path: "sum.ts",
              side: "source",
              complete: true,
              summary: "PRIVATE_FILE_PROSE",
              readIds: reads.map((r) => r.readId),
            },
          ],
          findings: [],
          questions: [],
        }),
      };
    },
  };
  const job = await prepareStandaloneReview(
    { repoRoot: f.repo, files: ["sum.ts"], scope: "staged" },
    {
      mode,
      ...(mode === "centralized"
        ? { connectionId: connection.id, freshness: "online" as const }
        : {}),
      profileId,
      provider: "codex",
      model: "gpt-6-astra",
      reasoningEffort: "xhigh",
      executablePath: "/unused",
      workspaceTrusted: true,
      durationMs: 30000,
      excludePatterns: [],
    },
    signal(),
    { ...ports, prepareExecutor: async () => executor },
  );
  const report = (await job.run(signal())).report.gcr!.report;
  assert.equal(report.status, "completed");
  let current = true;
  const options = {
    repoRoot: f.repo,
    profileId,
    connectionId: connection.id,
    report,
    current: () => current,
    ports,
  };
  const sessions: ReviewSubmissionSession[] = [];
  const open = async (
    overrides: Partial<Omit<typeof options, "report">> & {
      report?: unknown;
    } = {},
  ) => {
    const session = await ReviewSubmissionSession.open({
      ...options,
      ...overrides,
    });
    sessions.push(session);
    return session;
  };
  t.after(async () => {
    for (const session of sessions) session.close();
    await central.close();
    f.cleanup();
  });
  return {
    f,
    central,
    ports,
    scope,
    report,
    options,
    open,
    executor,
    modelCalls: () => modelCalls,
    changeSelection: () => {
      current = false;
    },
  };
}
const feedback = {
  kind: "feedback",
  feedbackKind: "correction",
  message: "Check the expected empty-input behavior.",
  includeSourceReference: false,
} as const;

test("saved review preview, encrypted outbox, explicit TLS delivery and reopen preserve one exact payload", async (t) => {
  const f = await setup(t),
    s = await f.open(),
    calls = f.central.calls;
  const preview = await s.prepare(feedback);
  assert.equal(f.central.calls, calls);
  assert.equal(f.central.submissionCalls, 0);
  assert.equal((await s.list()).length, 0);
  assert(!JSON.stringify(preview).includes("PRIVATE_"));
  assert.equal(preview.submission.kind, "feedback");
  if (preview.submission.kind === "feedback")
    assert.equal(preview.submission.feedback.source, null);
  await assert.rejects(s.save("0".repeat(64)), /confirmation-required/);
  const entry = await s.save(preview.payloadHash);
  assert.equal(entry.status, "pending");
  assert.equal(f.central.submissionCalls, 0);
  const reopened = await f.open();
  assert.deepEqual(await reopened.select(entry.payload.id), preview);
  f.central.setSubmissionStatus(200);
  const receipt = await reopened.send(preview.payloadHash, signal());
  assert.equal(receipt.status, "submitted");
  assert.equal(f.central.submissionCalls, 1);
  assert.deepEqual(
    f.central.submissions.get(entry.payload.id)?.payload,
    preview.submission,
  );
  assert.deepEqual(
    (await reopened.send(preview.payloadHash, signal())).receipt,
    receipt.receipt,
  );
  assert.equal(f.central.submissionCalls, 1);
  assert.equal(f.modelCalls(), 1);
});

test("rejected delivery is explicit, cancellation stops retries and local memory is a separate candidate", async (t) => {
  const f = await setup(t),
    s = await f.open(),
    preview = await s.prepare(feedback);
  f.central.setSubmissionStatus(403);
  const rejected = await s.send(preview.payloadHash, signal());
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.lastError, "http-403");
  assert.equal((await s.list()).length, 1);
  assert.equal(f.central.submissionCalls, 1);
  const memory = await s.saveLocalCandidate(preview.payloadHash);
  assert.deepEqual(await s.saveLocalCandidate(preview.payloadHash), memory);
  const saved = await withLocalKnowledge(
    f.scope,
    (store) => store.get(memory.id),
    f.ports,
  );
  assert.equal(saved?.state, "candidate");
  assert.equal(saved?.body, feedback.message);
  assert.equal(f.central.submissionCalls, 1);
  assert.equal((await s.cancel(rejected.payload.id)).status, "cancelled");
  await assert.rejects(s.send(preview.payloadHash, signal()), /cancelled/);
  assert.equal(f.central.submissionCalls, 1);
});

test("stale confirmation, changed selection and mismatched stored reports cannot submit", async (t) => {
  const f = await setup(t),
    s = await f.open();
  await assert.rejects(
    f.open({ report: { ...f.report, summary: "tampered" } }),
    /report-mismatch/,
  );
  const old = await s.prepare(feedback);
  const next = await s.prepare({ kind: "result" });
  await assert.rejects(
    s.send(old.payloadHash, signal()),
    /confirmation-required/,
  );
  await assert.rejects(
    s.saveLocalCandidate(next.payloadHash),
    /feedback-required/,
  );
  f.changeSelection();
  await assert.rejects(s.save(next.payloadHash), /selection-changed/);
  await assert.rejects(s.list(), /selection-changed/);
  assert.equal(f.central.submissionCalls, 0);
});

test("disconnect and an already cancelled caller stop submission, and an explicit retry reuses the request", async (t) => {
  const f = await setup(t),
    s = await f.open(),
    preview = await s.prepare(feedback);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    s.send(preview.payloadHash, controller.signal),
    /cancelled/,
  );
  assert.equal((await s.list()).length, 0);
  f.central.setSubmissionStatus(503);
  const pending = await s.send(preview.payloadHash, signal());
  assert.equal(pending.status, "pending");
  assert.equal(pending.lastError, "delivery-unconfirmed");
  f.central.setSubmissionStatus(200);
  const delivered = await s.send(preview.payloadHash, signal());
  assert.equal(delivered.status, "submitted");
  assert.equal(delivered.payload.id, pending.payload.id);
  await withCentralConnection(
    f.scope,
    (manager) => manager.disconnect(f.options.connectionId),
    f.ports,
  );
  await assert.rejects(s.prepare(feedback));
  assert.equal(f.central.submissionCalls, 2);
});

test("webview messages require the exact view, bounded selection and explicit hash confirmation", () => {
  const view = new ReviewSubmissionView(),
    base = { viewId: view.id };
  assert.deepEqual(
    view.message({ ...base, command: "prepare", selection: feedback }),
    { command: "prepare", selection: feedback },
  );
  assert.equal(
    view.message({ ...base, command: "send", hash: "a".repeat(64) }),
    undefined,
  );
  assert.equal(
    view.message({
      ...base,
      command: "send",
      hash: "a".repeat(64),
      confirmed: false,
    }),
    undefined,
  );
  assert.equal(
    view.message({
      ...base,
      command: "send",
      hash: "a".repeat(64),
      confirmed: true,
      serverUrl: "https://other",
    }),
    undefined,
  );
  assert.equal(
    view.message({
      ...base,
      command: "prepare",
      selection: { ...feedback, message: "x".repeat(4001) },
    }),
    undefined,
  );
  assert.equal(
    view.message({
      ...base,
      command: "prepare",
      selection: { ...feedback, source: "private" },
    }),
    undefined,
  );
  assert.equal(view.message({ command: "ready", viewId: "other" }), undefined);
  assert(view.html().includes("default-src 'none'"));
  assert(!view.html().includes("innerHTML"));
  assert(view.html().includes("Submit now"));
});

test("central reports retain their audience and snapshot and cannot be relabeled as standalone", async (t) => {
  const f = await setup(t, "centralized"),
    session = await f.open();
  const preview = await session.prepare(feedback);
  assert.equal(preview.submission.review.mode, "centralized");
  assert.equal(preview.submission.review.snapshot?.id, "snapshot");
  assert.deepEqual(preview.submission.audience, f.central.audience);
  await assert.rejects(
    session.prepare({ ...feedback, findingId: "unknown-finding" }),
  );
  f.central.setSubmissionStatus(200);
  assert.equal(
    (await session.send(preview.payloadHash, signal())).status,
    "submitted",
  );
  await assert.rejects(
    f.open({
      report: {
        ...f.report,
        identity: {
          ...f.report.identity,
          client: {
            ...f.report.identity.client,
            audience: { ...f.central.audience, userId: "other" },
          },
        },
      },
    }),
  );
  assert.equal(f.central.submissionCalls, 1);
});

type Criterion = Extract<
  CentralKnowledgeBundle,
  { component: "policy" }
>["criteria"][number];
const appliesTo = {
  languages: [],
  filePaths: ["sum.ts"],
  symbols: [],
  contracts: [],
  branches: [],
};
function criterion(revision = 1): Criterion {
  return {
    id: "criterion",
    revision,
    contentHash: contentHash(`published-${revision}`),
    sourceContentHash: contentHash(`source-${revision}`),
    document: {
      title: "Preserve addition",
      topicKey: "arithmetic",
      requirement: "Add both arguments.",
      rationale: "The caller expects a sum.",
      severity: "P2",
      enforcement: "advisory",
      reviewAfter: null,
      appliesTo,
      counterEvidence: ["The contract explicitly requires subtraction."],
      reviewSteps: ["Read the source and its caller."],
    },
    decision: {
      id: "decision",
      outcome: "defect",
      sources: [
        { kind: "manual", id: "fixture", contentHash: contentHash("manual") },
      ],
    },
    exceptions: [],
  };
}
function adoption(
  c = criterion(),
): NonNullable<ReviewSubmissionStatus["decision"]> {
  return {
    action: "create-candidate",
    note: "Adopted for review.",
    at: new Date().toISOString(),
    rule: {
      id: c.id,
      title: c.document.title,
      state: "active",
      revision: c.revision,
      contentHash: c.sourceContentHash,
    },
    feedback: null,
  };
}

test("explicit status, signed publication and a pinned re-review form separate steps", async (t) => {
  const f = await setup(t, "centralized"),
    s = await f.open();
  f.central.setSubmissionStatus(200);
  const preview = await s.prepare({ ...feedback, feedbackKind: "judgment" });
  const entry = await s.send(preview.payloadHash, signal()),
    id = entry.payload.id;
  assert.equal(f.central.reviewStatusCalls, 0);
  assert.equal((await s.reviewStatus(id, signal())).status.decision, null);
  await assert.rejects(
    s.prepareRereview(id, signal()),
    /synchronization-required/,
  );
  const decision = adoption();
  decision.rule!.state = "draft";
  f.central.setReviewDecision(id, decision);
  assert.equal(
    (await s.synchronizeStatus(id, signal())).sync?.policyState,
    "not-active",
  );
  decision.rule!.state = "active";
  f.central.setReviewDecision(id, decision);
  assert.equal(
    (await s.synchronizeStatus(id, signal())).sync?.policyState,
    "awaiting-publication",
  );
  const snapshotId = f.central.publishCriteria([criterion()]);
  const synced = await s.synchronizeStatus(id, signal());
  assert.equal(synced.sync?.policyState, "criterion-current");
  assert.equal(submissionFollowupSummary(synced).rereviewAllowed, true);
  const pin = await s.prepareRereview(id, signal());
  assert.equal(pin.snapshotId, snapshotId);
  assert.equal(f.modelCalls(), 1);
  assert.equal(f.central.submissionCalls, 1);
  const job = await prepareStandaloneReview(
    { repoRoot: f.f.repo, files: ["sum.ts"], scope: "staged" },
    {
      mode: "centralized",
      connectionId: pin.connectionId,
      profileId: pin.profileId,
      freshness: "online",
      offlineBehavior: "pause",
      requiredCentralSnapshot: pin.snapshotId,
      provider: "codex",
      model: "gpt-6-astra",
      reasoningEffort: "xhigh",
      executablePath: "/unused",
      workspaceTrusted: true,
      durationMs: 30000,
      excludePatterns: [],
    },
    signal(),
    { ...f.ports, prepareExecutor: async () => f.executor },
  );
  const report = (await job.run(signal())).report.gcr!.report;
  assert.equal(report.status, "completed");
  assert.equal(report.identity.context.centralSnapshot?.id, snapshotId);
  assert.notEqual(
    report.identity.context.centralSnapshot?.id,
    f.report.identity.context.centralSnapshot?.id,
  );
  assert(
    report.identity.context.entries.some(
      (e) => e.id === "criterion" && e.revision === 1,
    ),
  );
  assert.equal(f.modelCalls(), 2);
  f.central.setReviewDecision(id, adoption(criterion(2)));
  await assert.rejects(
    s.prepareRereview(id, signal()),
    /synchronization-required/,
  );
  assert.equal(f.modelCalls(), 2);
  f.central.setReviewStatus(404);
  await assert.rejects(s.reviewStatus(id, signal()), { statusCode: 404 });
  assert.equal(f.central.credentialValues.size, 1);
  f.central.setStatus(403, "CLIENT_ACCESS_REVOKED");
  await assert.rejects(s.reviewStatus(id, signal()));
  assert.equal(f.central.credentialValues.size, 0);
});

test("correction acknowledgement and exception approval require the corresponding signed policy", async (t) => {
  const f = await setup(t, "centralized"),
    s = await f.open();
  f.central.setSubmissionStatus(200);
  const preview = await s.prepare(feedback),
    entry = await s.send(preview.payloadHash, signal()),
    id = entry.payload.id;
  const c = criterion();
  f.central.publishCriteria([c]);
  const d = adoption(c);
  d.action = "link-feedback";
  d.feedback = {
    id: "feedback",
    kind: "correction",
    revision: 1,
    resolution: null,
    exception: null,
  };
  const check = async (expected: string) => {
    f.central.setReviewDecision(id, d);
    const value = await s.synchronizeStatus(id, signal());
    assert.equal(value.sync?.policyState, expected);
    assert.equal(
      submissionFollowupSummary(value).rereviewAllowed,
      ["criterion-current", "exception-current"].includes(expected),
    );
  };
  await check("pending-feedback");
  const resolution = {
    action: "reject" as const,
    note: "Reviewed independently.",
    at: new Date().toISOString(),
  };
  d.feedback.resolution = resolution;
  await check("feedback-rejected");
  d.feedback.resolution = { ...resolution, action: "acknowledge" };
  await check("acknowledged-only");
  const c2 = criterion(2);
  d.rule = adoption(c2).rule;
  await check("awaiting-publication");
  f.central.publishCriteria([c2]);
  await check("criterion-current");
  d.feedback.kind = "exception";
  d.feedback.revision = 2;
  d.feedback.resolution = { ...resolution, action: "approve-exception" };
  const e = {
    id: "exception",
    revision: 2,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    revoked: false,
  };
  d.feedback.exception = e;
  await check("awaiting-publication");
  c2.exceptions = [
    {
      id: e.id,
      startsAt: e.startsAt,
      expiresAt: e.expiresAt,
      reason: "Recorded exception.",
      appliesTo,
    },
  ];
  f.central.publishCriteria([c2]);
  await check("exception-current");
  e.revoked = true;
  await check("exception-inactive");
  e.revoked = false;
  e.expiresAt = new Date(Date.now() - 1000).toISOString();
  await check("exception-inactive");
  e.expiresAt = new Date(Date.now() + 3600000).toISOString();
  e.startsAt = new Date(Date.now() + 60000).toISOString();
  await check("exception-inactive");
  d.rule = adoption(criterion(3)).rule;
  await check("outdated-exception");
  assert.equal(f.modelCalls(), 1);
});

test("follow-up webview messages cannot supply an arbitrary destination or bypass the re-review click", () => {
  const view = new ReviewSubmissionView(),
    base = { viewId: view.id, id: "submission" };
  for (const command of ["review-status", "synchronize", "open-central"]) {
    assert.deepEqual(view.message({ ...base, command }), {
      command,
      id: base.id,
    });
    assert.equal(
      view.message({ ...base, command, url: "https://other.invalid" }),
      undefined,
    );
  }
  assert.equal(view.message({ ...base, command: "rereview" }), undefined);
  assert.equal(
    view.message({ ...base, command: "rereview", confirmed: false }),
    undefined,
  );
  assert.deepEqual(
    view.message({ ...base, command: "rereview", confirmed: true }),
    { command: "rereview", id: base.id },
  );
});
