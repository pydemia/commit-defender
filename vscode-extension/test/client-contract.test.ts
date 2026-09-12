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
import { normalizeReport } from "../src/commentFormatter.js";
import { resolveExitCode } from "../src/exitResolver.js";
import { reviewCoverage, reviewStatus } from "../src/reviewOutcome.js";
import { liveBlocks, sourceAnchor } from "../src/reviewSource.js";
import type { AnalysisReport } from "../src/types.js";
import { fixture } from "./helpers/review-fixture.js";

const fixtureDir = path.resolve(__dirname, "../test/fixtures/client-contract");
const bytes = fs.readFileSync(path.join(fixtureDir, "reports.json"));
const provenance = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "provenance.json"), "utf8"),
);
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

test("uses a pinned installed package and the byte-identical GCR fixture", () => {
  assert.equal(corpus.synthetic, true);
  assert.equal(sha256(bytes), provenance.fixtureSha256);
  assert.equal(clientContractPackage.version, provenance.packageVersion);
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
  );
  assert.equal(
    packageJson.devDependencies["@gcr/client-contract"],
    `file:vendor/gcr/${provenance.packageVersion}/gcr-client-contract-${provenance.packageVersion}.tgz`,
  );
  const vendor = path.resolve(
    __dirname,
    "../vendor/gcr",
    provenance.packageVersion,
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(vendor, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.version, provenance.packageVersion);
  for (const entry of manifest.packages)
    assert.equal(
      sha256(fs.readFileSync(path.join(vendor, entry.file))),
      entry.sha256,
    );
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
