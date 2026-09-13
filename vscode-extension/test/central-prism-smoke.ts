/** Explicit account invocation on task-owned source. Never included in npm test or VSIX. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  defaultLocalDataDirectory,
  PlatformLocalKeyStore,
} from "@gcr/client-core";
import { reviewExitCode } from "@gcr/client-contract";
import { prepareStandaloneWorker } from "../src/standaloneWorkerClient.js";
import { knowledgeScope } from "../src/localKnowledge.js";
import {
  readCentralHistory,
  readSelectedHistory,
  withCentralConnection,
} from "../src/centralConnection.js";
import { fixture } from "./helpers/review-fixture.js";

async function main() {
  assert.equal(process.platform, "darwin");
  assert(
    process.env.CD_CENTRAL_CODEX_EXECUTABLE,
    "Select the current account's Codex executable explicitly.",
  );
  assert(process.env.CD_CENTRAL_EVIDENCE, "Select an evidence file.");
  const fallback = process.env.CD_CENTRAL_FALLBACK_SMOKE === "1";
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  assert.equal(input.config.serverUrl, "https://pr-review.prism.ai");
  assert.equal(typeof input.witness, "string");
  const f = fixture(),
    profileId = `cd-prism-${randomUUID()}`,
    witness = input.witness;
  const central = {
    config: input.config,
    secret: input.token,
    close: async () => {},
  };
  const location = {
    repoRoot: f.repo,
    profileId,
    scope: "repository" as const,
  };
  const scope = knowledgeScope(location);
  assert.equal(scope.kind, "repository");
  let id: string | undefined;
  let job: Awaited<ReturnType<typeof prepareStandaloneWorker>> | undefined;
  let running = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), 300000);
  const workerFile = path.resolve(
    process.env.CD_CENTRAL_WORKER ?? "out/standalone-review-worker.js",
  );
  const proof: Record<string, unknown> = {
    workerSha256: createHash("sha256")
      .update(fs.readFileSync(workerFile))
      .digest("hex"),
    status: "running",
    syntheticSource: true,
    centralServer: "https://pr-review.prism.ai",
    centralServerIsFixture: false,
    realAccount: true,
    model: "gpt-6-astra",
    reasoningEffort: "xhigh",
    nativeWorker: true,
    fallbackSmoke: fallback,
    extensionHostUi: false,
  };
  const checkpoint = () =>
    fs.writeFileSync(
      process.env.CD_CENTRAL_EVIDENCE!,
      JSON.stringify(proof, null, 2) + "\n",
    );
  try {
    f.write(
      "sum.ts",
      "export function total(amounts: number[]): number {\n  return amounts.reduce((sum, amount) => sum + amount, 0);\n}\n",
    );
    f.write(
      "caller.ts",
      "import { total } from './sum.js';\nexport function invoice() { return { amountCents: total([125, 75]), currency: 'USD' }; }\n",
    );
    f.write(
      "sum.test.ts",
      "import assert from 'node:assert/strict';\nimport { total } from './sum.js';\nassert.equal(total([125, 75]), 200);\nassert.equal(total([]), 0);\n",
    );
    f.git("add", ".");
    f.git("commit", "-m", "synthetic cents contract");
    f.write(
      "sum.ts",
      "export function total(amounts: number[]): number {\n  return amounts.reduce((sum, amount) => sum + amount, 0) / 100;\n}\n",
    );
    f.git("add", "sum.ts");
    const connectionStarted = Date.now();
    const connection = await withCentralConnection(scope, (c) =>
      c.connect(central.config, central.secret, "commit-defender"),
    );
    id = connection.id;
    proof.initialConnectMilliseconds = Date.now() - connectionStarted;
    proof.connectInvocations = 1;
    proof.explicitPublicationPolling = false;
    const selection = {
      version: 1 as const,
      mode: "centralized" as const,
      connectionId: id,
      freshness: "online" as const,
    };
    if (fallback) {
      await withCentralConnection(scope, (manager) => manager.disconnect(id!));
      proof.fallbackTrigger = "explicit-disconnect-after-authenticated-sync";
    }
    job = await prepareStandaloneWorker(
      workerFile,
      { repoRoot: f.repo, files: ["sum.ts"], scope: "staged" },
      {
        ...selection,
        offlineBehavior: fallback ? "cache-then-standalone" : "pause",
        profileId,
        provider: "codex",
        model: "gpt-6-astra",
        reasoningEffort: "xhigh",
        executablePath: process.env.CD_CENTRAL_CODEX_EXECUTABLE!,
        workspaceTrusted: true,
        durationMs: 180000,
        excludePatterns: [],
      },
      controller.signal,
    );
    assert.equal(job.backendId, fallback ? "standalone" : "centralized");
    running = true;
    const result = await job.run(controller.signal);
    running = false;
    const report = result.report.gcr!.report;
    assert(!JSON.stringify(report).includes(central.secret));
    proof.report = report;
    checkpoint();
    assert.equal(report.status, "completed");
    assert.equal(reviewExitCode(report), 1);
    assert.equal(
      report.identity.client.mode,
      fallback ? "standalone" : "centralized",
    );
    proof.execution = report.identity.client.execution;
    if (fallback) {
      assert.equal(
        report.identity.client.execution?.configuredMode,
        "centralized",
      );
      assert.equal(report.identity.client.execution?.knowledgeSource, "local");
      assert.equal(report.identity.context.centralSnapshot, undefined);
      assert(
        report.identity.context.entries.every(
          (entry) => entry.origin !== "central",
        ),
      );
      assert(!JSON.stringify(report).includes(witness));
    }
    assert.equal(result.report.review.blocking, false);
    if (!fallback) assert(JSON.stringify(report.findings).includes(witness));
    assert(
      report.findings.some(
        (f) =>
          f.anchor.path === "sum.ts" &&
          f.anchor.startLine === 2 &&
          f.anchorValidation.status === "verified",
      ),
    );
    for (const name of ["sum.ts", "caller.ts", "sum.test.ts"])
      assert(
        report.evidence.some(
          (e) => e.kind === "source-read" && e.location.path === name,
        ),
      );
    const history = fallback
      ? await readSelectedHistory(location, selection)
      : await readCentralHistory(location, selection);
    assert.deepEqual(history.reports, [report]);
    proof.exactHistoryRestored = true;
    const disconnected = await withCentralConnection(scope, (c) =>
      c.disconnect(id!),
    );
    assert.equal(disconnected.credentialCleanupPending, false);
    await assert.rejects(readCentralHistory(location, selection));
    proof.disconnected = true;
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.failure =
      error instanceof Error ? error.message.slice(0, 1000) : "Smoke failed";
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    controller.abort("disposed");
    if (!running) await job?.dispose?.();
    if (id) await withCentralConnection(scope, (c) => c.disconnect(id!));
    const base = defaultLocalDataDirectory();
    const directories = [
      path.join(base, "profiles", profileId),
      path.join(base, "central-connections", "profiles", profileId),
      ...(id
        ? [
            path.join(base, "central-cache", id, "profiles", profileId),
            path.join(
              base,
              "central-review-history",
              id,
              "profiles",
              profileId,
            ),
          ]
        : []),
    ];
    const refs = new Set<string>();
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name === "key-ref.json") {
          const ref = JSON.parse(fs.readFileSync(file, "utf8"));
          assert.equal(ref.profileId, profileId);
          assert.match(ref.id, /^[a-f0-9-]{36}$/);
          refs.add(`${profileId}.${ref.id}`);
        }
      }
    };
    for (const dir of directories) walk(dir);
    const keys = new PlatformLocalKeyStore();
    for (const ref of refs) await keys.remove(ref);
    for (const dir of directories)
      fs.rmSync(dir, { recursive: true, force: true });
    await central.close();
    f.cleanup();
    proof.testKeysRemoved = true;
    checkpoint();
  }
}
void main().catch(() => {
  process.stderr.write(
    "Central account smoke failed during setup or cleanup; raw diagnostics withheld.\n",
  );
  process.exitCode = 1;
});
