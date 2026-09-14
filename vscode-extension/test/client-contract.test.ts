import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  clientContractPackage,
  clientReviewReport,
  projectCommitDefender,
  reviewExitCode,
  type ClientReviewReport,
} from "@gcr/client-contract";
import { clientCorePackage } from "@gcr/client-core";
import { clientExecutorsPackage } from "@gcr/client-executors";
import { normalizeReport } from "../src/commentFormatter.js";
import { resolveExitCode } from "../src/exitResolver.js";
import { reviewCoverage, reviewStatus } from "../src/reviewOutcome.js";
import { liveBlocks, sourceAnchor } from "../src/reviewSource.js";
import type { AnalysisReport } from "../src/types.js";
import { fixture } from "./helpers/review-fixture.js";
import { SummaryView } from "../src/summaryView.js";
import { ReviewLinks } from "../src/reviewLinks.js";
import { mergeLocalHistory } from "../src/historyEntries.js";
import type { HistoryEntry } from "../src/historyProvider.js";

const fixtureDir = path.resolve(__dirname, "../test/fixtures/client-contract");
const bytes = fs.readFileSync(path.join(fixtureDir, "reports.json"));
const provenance = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "provenance.json"), "utf8"),
);
const deliveryVersion = "0.1.0-alpha.35";
const corpus = JSON.parse(bytes.toString("utf8")) as {
  synthetic: boolean;
  sourceText: Record<string, string>;
  baseText: Record<string, string>;
  cases: Array<{
    name: string;
    report: unknown;
    expected: { legacyStatus: string; exitCode: number; comments: number };
  }>;
};
const reportFor = (name: string): ClientReviewReport =>
  clientReviewReport(corpus.cases.find((entry) => entry.name === name)!.report);
const sha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

test("standalone summary distinguishes pinned evidence and a later local-context observation", () => {
  const core = reportFor("source-evidence");
  const projected: AnalysisReport = projectCommitDefender(core);
  const original = structuredClone(core);
  projected.local_context_freshness = {
    checkedAt: "2026-09-13T00:00:00.000Z",
    status: "stale",
    changes: [{ id: "local-memory", reason: "inactive" }],
  };
  const view = new SummaryView(projected, "/synthetic", new ReviewLinks());
  assert(view.html.includes("Standalone · advisory"));
  assert(!view.html.includes("Legacy hook: would block"));
  assert(view.html.includes("changed, expired or became inactive"));
  assert(view.html.includes("source-confirmed"));
  assert(
    view.html.includes(
      "Source-read observations record returned source ranges",
    ),
  );
  assert(view.html.includes(core.identity.source.hash));
  assert(view.html.includes(core.identity.context.hash));
  assert(view.html.includes("Raw JSON"));
  assert.deepEqual(projected.gcr?.report, original);
});

test("failed standalone summary exposes the stored problem and escapes message markup", () => {
  const core = clientReviewReport({
    ...reportFor("failed"),
    problems: [
      {
        code: "invalid-output",
        message:
          'Review response rejected (invalid-json): <img src=x onerror="alert(1)">',
      },
    ],
  });
  const projected: AnalysisReport = projectCommitDefender(core);
  const view = new SummaryView(projected, "/synthetic", new ReviewLinks());
  assert(view.html.includes("Review problems"));
  assert(view.html.includes("invalid-output"));
  assert(view.html.includes("(invalid-json)"));
  assert(view.html.includes("&lt;img src=x onerror="));
  assert(!view.html.includes('<img src=x onerror="alert(1)">'));
  assert.deepEqual(projected.gcr?.report, core);
  assert.equal(projected.review.status, "failed");
  assert.equal(projected.review.blocking, false);
});

test("history reload preserves a concurrently completed review and excludes other profiles and worktrees", () => {
  const old = reportFor("working-tree");
  const newer = clientReviewReport({
    ...old,
    runId: "newer-run",
    finishedAt: "2026-01-01T00:00:02.000Z",
  });
  const client = old.identity.client;
  const scope = {
    kind: "repository" as const,
    profileId: client.profileId,
    repositoryKey: client.repositoryKey,
    worktreeKey: client.worktreeKey,
  };
  const otherProfile = clientReviewReport({
    ...old,
    runId: "other-profile",
    identity: {
      ...old.identity,
      client: { ...client, profileId: "other-profile" },
    },
  });
  const otherWorktree = clientReviewReport({
    ...old,
    runId: "other-worktree",
    identity: {
      ...old.identity,
      client: { ...client, worktreeKey: "a".repeat(64) },
    },
  });
  const entry: HistoryEntry = {
    id: newer.runId,
    timestamp: new Date(newer.finishedAt!),
    report: projectCommitDefender(newer),
    repoRoot: "/synthetic",
    label: "Existing directory review",
    scope: "directory",
    scopeTarget: "/synthetic/src",
  };
  const merged = mergeLocalHistory(
    [entry],
    [old, otherProfile, otherWorktree],
    "/synthetic",
    scope,
  );
  assert.deepEqual(
    merged.map((value) => value.id),
    [newer.runId, old.runId],
  );
  assert.equal(merged[0].scope, "directory");
  assert.equal(merged[0].scopeTarget, "/synthetic/src");
  assert.equal(merged[1].scope, "selection");
  assert.deepEqual(
    merged[1].report.staged_files,
    old.files.map((file) => file.source.path),
  );
});

test("uses a pinned installed package and the byte-identical GCR fixture", () => {
  assert.equal(corpus.synthetic, true);
  assert.equal(sha256(bytes), provenance.fixtureSha256);
  // The C01 fixture retains its original provenance; the installed runtime release is newer.
  assert.equal(provenance.packageVersion, "0.1.0-alpha.2");
  for (const info of [
    clientContractPackage,
    clientCorePackage,
    clientExecutorsPackage,
  ]) {
    assert.equal(info.version, deliveryVersion);
    assert.equal(info.contractVersion, 1);
  }
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
  );
  assert.equal(
    packageJson.dependencies["@gcr/client-contract"],
    `file:vendor/gcr/${deliveryVersion}/gcr-client-contract-${deliveryVersion}.tgz`,
  );
  const vendor = path.resolve(__dirname, "../vendor/gcr", deliveryVersion);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(vendor, "manifest.json"), "utf8"),
  );
  const delivery = JSON.parse(
    fs.readFileSync(path.join(vendor, "provenance.json"), "utf8"),
  );
  assert.equal(delivery.packageVersion, deliveryVersion);
  assert.equal(
    delivery.manifestSha256,
    sha256(fs.readFileSync(path.join(vendor, "manifest.json"))),
  );
  assert.equal(manifest.version, deliveryVersion);
  for (const entry of manifest.packages) {
    assert.equal(
      packageJson.dependencies[entry.name],
      `file:vendor/gcr/${deliveryVersion}/${entry.file}`,
    );
    assert.equal(
      sha256(fs.readFileSync(path.join(vendor, entry.file))),
      entry.sha256,
    );
  }
});

for (const entry of corpus.cases)
  test(`${entry.name}: CD preserves outcome, coverage, anchors and advisory semantics`, () => {
    const original = clientReviewReport(entry.report);
    const projected = projectCommitDefender(original);
    // This assignment compiles against CD's production interface, not a duplicate fixture type.
    const report: AnalysisReport = projected;
    const blocks = normalizeReport(report);
    assert.equal(reviewStatus(report.review), entry.expected.legacyStatus);
    assert.equal(reviewExitCode(original), entry.expected.exitCode);
    assert.equal(blocks.length, entry.expected.comments);
    assert.equal(resolveExitCode(report, "advisory"), 0);
    assert.equal(report.exit_code, 0);
    assert.equal(report.review.blocking, false);
    assert.deepEqual(projected.gcr.report, original);
    assert.deepEqual(
      report.review.incomplete_reasons,
      original.problems.map((problem) => problem.code),
    );
    assert.deepEqual(report.source_exclusions, original.excluded);
    for (const file of original.files) {
      assert.deepEqual(sourceAnchor(report, file.source.path), {
        sha256: file.source.hash,
        line_count: file.source.lineCount,
        side: file.source.side,
      });
    }
    if (original.status !== "completed") assert.equal(report.review.grade, "");
    assert(
      reviewCoverage(report).includes(
        `${original.files.length} selected file(s) completed`,
      ),
    );
  });

test("P3 remains a finding without enabling the new advisory hook to block", () => {
  const projected = projectCommitDefender(
    reportFor("legacy-verified-advisory"),
  );
  assert.equal(normalizeReport(projected)[0].priority, "P3");
  assert.equal(resolveExitCode(projected, "advisory"), 0);
  assert.equal(resolveExitCode(projected, "legacy-hook"), 1);
  const finding = projected.gcr.report.findings[0];
  assert.equal(finding.confidence, "high");
  assert.equal(finding.legacyVerification!.status, "verified");
  assert.equal(finding.anchorValidation.status, "verified");
  assert.equal(finding.evidenceAssessment.level, "unassessed");
  assert.equal(finding.category, "compatibility");
  assert.equal(projected.review.file_comments[0].category, "");
});

test("fixed source hashes allow matching overlays and reject later buffer/file changes", () => {
  const f = fixture();
  try {
    for (const [file, text] of Object.entries(corpus.sourceText))
      f.write(file, text);
    const projected = projectCommitDefender(
      reportFor("legacy-verified-advisory"),
    );
    const blocks = normalizeReport(projected);
    assert.equal(liveBlocks(projected, f.repo, blocks).length, 1);
    assert.equal(
      liveBlocks(
        projected,
        f.repo,
        blocks,
        () => corpus.sourceText["source.ts"] + "// changed buffer\n",
      ).length,
      0,
    );
    f.write("source.ts", corpus.sourceText["source.ts"] + "// changed disk\n");
    assert.equal(liveBlocks(projected, f.repo, blocks).length, 0);
  } finally {
    f.cleanup();
  }
});

test("accepted exceptions and source/test claims remain available in Raw JSON", () => {
  const exception = projectCommitDefender(reportFor("accepted-exception"));
  assert.equal(exception.gcr.report.findings[0].outcome, "violation");
  assert.equal(
    exception.gcr.report.findings[0].policy.exceptionId,
    "exception-fixture",
  );
  assert.equal(reviewExitCode(exception.gcr.report), 0);
  const testClaim = projectCommitDefender(reportFor("test-evidence-claim"));
  const roundTrip = JSON.parse(JSON.stringify(testClaim));
  assert.deepEqual(
    roundTrip.gcr.report.evidence,
    testClaim.gcr.report.evidence,
  );
  assert(
    testClaim.gcr.report.evidence.every(
      (evidence) => evidence.provenance.kind === "client-claim",
    ),
  );
  assert.equal(
    testClaim.gcr.report.findings[0].evidenceAssessment.level,
    "test-confirmed",
  );
});

test("evaluations omitted from legacy comments never become summary-generated findings", () => {
  const report = reportFor("legacy-verified-advisory");
  report.findings[0].outcome = "not-applicable";
  report.findings[0].followUp = "none";
  const projected = projectCommitDefender(report);
  assert.equal(normalizeReport(projected).length, 0);
  assert.equal(projected.gcr.projectionOmissions.length, 1);
  assert.equal(projected.gcr.report.findings[0].outcome, "not-applicable");
});

test("fallback reports show configured and effective modes without claiming central policy compliance", () => {
  const original = reportFor("source-evidence");
  const core = clientReviewReport({
    ...original,
    identity: {
      ...original.identity,
      client: {
        ...original.identity.client,
        execution: {
          configuredMode: "centralized",
          effectiveMode: "standalone",
          knowledgeSource: "local",
          fallbackReason: "unavailable",
          connectionId: "c".repeat(64),
        },
      },
    },
  });
  const view = new SummaryView(
    projectCommitDefender(core),
    "/synthetic",
    new ReviewLinks(),
  );
  assert(view.html.includes("Standalone · fallback: unavailable"));
  assert(view.html.includes("Configured mode: centralized"));
  assert(view.html.includes("Effective mode: standalone"));
  assert(
    view.html.includes("does not establish compliance with central policy"),
  );
  assert(!view.html.includes("<h2>Central knowledge used</h2>"));
});
