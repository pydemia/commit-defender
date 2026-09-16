import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type * as vscode from "vscode";
import {
  callLocalService,
  contentHash,
  defaultLocalDataDirectory,
  discoverLocalIdentity,
  executeReviewRequest,
  LocalHistoryStore,
  LocalKnowledgeStore,
  LocalRecordStore,
  resolveLocalContext,
  resolveLocalExecutionPolicy,
  resolveReviewExecution,
  restoreLocalSource,
  ReviewRequests,
  reviewRequestKey,
  runLocalReview,
  startLocalService,
  type LocalReviewExecutor,
  type ServiceJob,
} from "@gcr/client-core";
import { AutomaticReviews } from "../src/automaticReviews.js";
import { BackgroundHooks } from "../src/backgroundHooks.js";
import type { SelectionStore } from "../src/centralConnection.js";
import type { StandaloneReviewSettings } from "../src/standaloneReviewProtocol.js";
import { fixture } from "./helpers/review-fixture.js";
import {
  events,
  reset,
  Uri,
  values,
  watchers,
  workspace,
} from "./helpers/vscode-automatic.js";

const fields = ["save", "stage", "commit", "push"] as const;
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw Error(`Matrix did not settle: ${label}`);
    await delay(20);
  }
}

// These tests use real Git hooks, the delivered CLI's capture/IPC, encrypted stores,
// and the shared broker. Only the VS Code event source and model are synthetic.
// Service run uses the public core pipeline with the same identity/context policy
// as standaloneReview; CLI service-run argument parsing has its own GCR tests.
for (let mask = 0; mask < 16; mask++) {
  test(
    `runtime trigger matrix ${mask.toString(2).padStart(4, "0")} (push commit stage save)`,
    // Native ACL/IPC probes add process startup cost; this is a synthetic
    // integration-test deadline, independent of the model request budget.
    { timeout: process.platform === "win32" ? 180000 : 90000 },
    async (t) => {
      reset();
      const f = fixture();
      const root = realpathSync(f.repo);
      const profileId = `trigger-matrix-${randomUUID()}`;
      const dataDirectory = defaultLocalDataDirectory();
      const location = { profileId, dataDirectory };
      const managedDirectory = path.join(
        dataDirectory,
        "managed-hooks",
        createHash("sha256")
          .update(path.join(root, ".git/config"))
          .digest("hex"),
      );
      const keyValues = new Map<string, Buffer>();
      const keys = {
        read: async (id: string) =>
          keyValues.has(id) ? Buffer.from(keyValues.get(id)!) : undefined,
        write: async (id: string, value: Buffer) => {
          keyValues.set(id, Buffer.from(value));
        },
        remove: async (id: string) => {
          keyValues.delete(id);
        },
      };
      const storage = { dataDirectory, keys };
      const settings: StandaloneReviewSettings = {
        mode: "standalone",
        profileId,
        provider: "codex",
        model: "gpt-6-astra",
        reasoningEffort: "xhigh",
        executablePath: process.platform === "win32" ? process.execPath : "/usr/bin/false",
        workspaceTrusted: true,
        durationMs: 120000,
        excludePatterns: [],
      };
      const calls: string[] = [];
      const completed: string[] = [];
      const failures: string[] = [];
      const executor: LocalReviewExecutor = {
        descriptor: {
          id: "trigger-matrix",
          version: "1",
          model: "fixture",
          configHash: contentHash("trigger-matrix"),
          capabilities: {
            available: true,
            sourceIsolation: "fixed-source-only",
            cancellation: true,
            timeout: true,
            childProcessCleanup: true,
            outputTokenLimit: false,
          },
        },
        review: async (input) => {
          calls.push("synthetic-executor");
          const reads = await Promise.all(
            ["source", "base"].map(async (side) =>
              JSON.parse(
                await input.source.execute("read_file", { path: "a.ts", side }),
              ),
            ),
          );
          return {
            model: "fixture",
            raw: JSON.stringify({
              summary: "Synthetic matrix review",
              files: [
                {
                  path: "a.ts",
                  side: "source",
                  complete: true,
                  summary: "Read source and base",
                  readIds: reads.map((r) => r.readId),
                },
              ],
              findings: [],
              questions: [],
            }),
          };
        },
      };
      f.write("a.ts", "export const a=1;\n");
      f.write(
        "0-caller.ts",
        "import { a } from './a.ts';\nexport const value = () => a;\n",
      );
      f.git("add", ".");
      f.git("commit", "-m", "base");
      const remote = path.join(f.root, "remote.git");
      f.git("init", "--bare", remote);
      f.git("remote", "add", "origin", remote);
      f.git("push", "origin", "main");
      const localClient = discoverLocalIdentity(root, profileId);
      const scope = {
        kind: "repository" as const,
        profileId,
        repositoryKey: localClient.repositoryKey,
        worktreeKey: localClient.worktreeKey,
      };
      const service = await startLocalService({
        ...location,
        keys,
        run: async ({ source, signal, job, bindRequest }) => {
          const snapshot = restoreLocalSource(source);
          const records: LocalRecordStore[] = [];
          try {
            for (const recordScope of [
              scope,
              { kind: "profile" as const, profileId },
            ])
              records.push(
                await LocalRecordStore.open({ ...storage, scope: recordScope }),
              );
            const { client } = await resolveReviewExecution({
              client: localClient,
              configuredMode: "standalone",
              offlineBehavior: "pause",
              signal,
            });
            const context = await resolveLocalContext({
              client,
              snapshot,
              stores: records.map((r) => new LocalKnowledgeStore(r)),
            });
            assert.equal(context.status, "ready");
            if (context.status !== "ready") throw Error("context unavailable");
            const policy = resolveLocalExecutionPolicy({
              context,
              snapshot,
              executor: executor.descriptor,
              workspaceTrusted: true,
              approval: {
                client,
                executor: executor.descriptor,
                sourceHash: snapshot.identity.hash,
                paths: ["**"],
                allowBase: true,
                allowRelated: true,
                allowKnowledge: true,
              },
              budget: { durationMs: settings.durationMs },
            });
            if (policy.status !== "ready") throw Error("policy unavailable");
            const history = new LocalHistoryStore(records[0]);
            const result = await executeReviewRequest({
              storage: { ...storage, scope },
              identity: policy.policy.identity,
              reason: job.trigger,
              signal,
              onRequest: bindRequest,
              limits: { maximumReviewsPerHour: 100 },
              loadReport: (id) => history.getReview(id),
              saveReport: (report) => history.saveReview(report),
              run: (runSignal) =>
                runLocalReview({
                  snapshot,
                  context: context.context,
                  policy: policy.policy,
                  executor,
                  signal: runSignal,
                  trigger: job.trigger,
                }),
            });
            assert.equal(result.persisted && result.recorded, true);
            completed.push(job.trigger);
            return {
              status: result.report.status,
              runId: result.report.runId,
              exitCode: 0,
            };
          } finally {
            snapshot.close();
            records.forEach((r) => r.close());
          }
        },
      });
      const state = new Map<string, unknown>();
      const store: SelectionStore = {
        get: <T>(key: string) => state.get(key) as T | undefined,
        update: async (key, value) => {
          state.set(key, value);
        },
      };
      const hooks = new BackgroundHooks(process.cwd(), store);
      let controller: AutomaticReviews | undefined;
      t.after(async () => {
        controller?.dispose();
        await controller?.settled();
        try {
          await hooks.pauseAll();
        } finally {
          await service.close();
          await assert.rejects(
            callLocalService(location, { action: "status" }, 500),
            (error: unknown) =>
              (error as { code?: string }).code === "service-unavailable",
          );
          await rm(managedDirectory, { recursive: true, force: true });
          for (const area of ["", "review-requests", "local-service"])
            await rm(path.join(dataDirectory, area, "profiles", profileId), {
              recursive: true,
              force: true,
            });
          keyValues.forEach((key) => key.fill(0));
          keyValues.clear();
          f.cleanup();
          reset();
        }
      });
      const enabled = (field: (typeof fields)[number]) =>
        !!(mask & (1 << fields.indexOf(field)));
      values.global = {
        localProfile: profileId,
        automaticSaveIntervalSeconds: 10,
        automaticReviewsPerHour: 100,
        aiProvider: "codex",
        model: "gpt-6-astra",
        reviewReasoningEffort: "xhigh",
        codexPath: settings.executablePath,
        ...Object.fromEntries(
          fields.map((field) => [
            `runOn${field[0].toUpperCase()}${field.slice(1)}`,
            enabled(field),
          ]),
        ),
      };
      workspace.workspaceFolders = [{ uri: Uri.file(root) }];
      let now = 100000;
      controller = new AutomaticReviews(
        { globalState: store } as unknown as vscode.ExtensionContext,
        {
          busy: () => false,
          storage,
          debounceMs: 1000,
          now: () => now,
          state: (s) => {
            if (s.phase === "failed") failures.push(s.reason ?? "unknown");
          },
          configureHooks: (repo, automatic) =>
            hooks.configure(repo, automatic, settings, process.execPath, 0),
          pauseHooks: () => hooks.pauseAll(),
          backgroundStage: (root) => hooks.watchesStage(root),
          backgroundSave: (root, event) => hooks.saveEvent(root, event),
          run: async () => {
            assert.fail(
              "Automatic Save/Stage must execute in the background service.",
            );
          },
        },
      );
      await controller.refresh();
      const status = async () =>
        (await callLocalService(location, { action: "status" })) as {
          pid: number;
          jobs: ServiceJob[];
        };
      assert.equal(
        (await status()).pid,
        process.pid,
        "bundled CLI must reuse the fixture service",
      );
      const git = async (...args: string[]) => {
        const result = await promisify(execFile)(
          "git",
          ["-C", root, "-c", "commit.gpgsign=false", ...args],
          { timeout: 45000 },
        );
        assert.doesNotMatch(
          result.stderr,
          /enqueue failed|could not|unavailable|incomplete/i,
          result.stderr,
        );
        return result;
      };
      const save = () => {
        const document = {
          uri: Uri.file(path.join(root, "a.ts")),
          isDirty: false,
        };
        events.willSave.fire({ document, reason: 1 });
        events.didSave.fire(document);
      };
      const stage = () => {
        for (const w of watchers)
          if (!w.disposed && w.pattern.pattern === "index")
            w.change.fire(
              Uri.file(path.join(w.pattern.baseUri.fsPath, "index")),
            );
      };
      const advance = async () => {
        // Editor observation finishes here; the service uses its real polling/debounce clock.
        await controller!.settled();
        now += 2000;
        events.focus.fire({ focused: true });
        await controller!.settled();
      };
      f.write("a.ts", "export const a=2;\n");
      save();
      await advance();
      if (enabled("save"))
        await until(() => completed.includes("save"), "save completion");
      f.git("add", "a.ts");
      stage();
      await advance();
      if (enabled("stage"))
        await until(() => completed.includes("stage"), "stage completion");
      // No-op Save/index events must not invoke the model again.
      const beforeRepeat = calls.length;
      save();
      stage();
      await advance();
      await delay(100);
      assert.equal(calls.length, beforeRepeat, "no-op editor events");
      if (enabled("commit")) {
        await git("hook", "run", "pre-commit");
        await git("hook", "run", "pre-commit");
      }
      await git("commit", "-m", "matrix change");
      await git("push", "--dry-run", "origin", "main");
      await git("push", "--dry-run", "origin", "main");
      await git("push", "origin", "main");
      assert.equal(
        f.git("rev-parse", "HEAD").trim(),
        f.git("ls-remote", "origin", "refs/heads/main").trim().split(/\s+/)[0],
      );
      const expectedJobs =
        Number(enabled("save")) +
        Number(enabled("stage")) +
        (enabled("commit") ? 3 : 0) +
        (enabled("push") ? 3 : 0);
      await until(async () => {
        const s = await status();
        assert.ok(
          !s.jobs.some((job) => ["failed", "interrupted"].includes(job.state)),
          JSON.stringify(s.jobs),
        );
        return (
          s.jobs.length === expectedJobs &&
          s.jobs.every((job) => job.state === "finished")
        );
      }, "all automatic receipts completed");
      await delay(100);
      const requests = await ReviewRequests.open({ ...storage, scope });
      try {
        const rows = await requests.list();
        const reasons = [...new Set(rows.flatMap((row) => row.reasons))].sort();
        assert.deepEqual(
          reasons,
          fields.filter(enabled).sort(),
          "exact enabled trigger set in durable broker",
        );
        assert.equal(
          calls.length,
          rows.length,
          "one executor invocation per distinct durable identity",
        );
        assert.equal(
          calls.length,
          Number(enabled("save")) +
            Number(enabled("stage") || enabled("commit")) +
            Number(enabled("push")),
          "Stage and Commit share an index request; working-tree and pushed commit-tree remain separate",
        );
        if (enabled("stage") && enabled("commit"))
          assert.ok(
            rows.some(
              (row) =>
                row.reasons.includes("stage") && row.reasons.includes("commit"),
            ),
            "cross-trigger index reuse",
          );
        for (const job of (await status()).jobs) {
          const row = rows.find((r) => r.key === job.execution?.key);
          assert.ok(
            row,
            "every finished automatic receipt binds to the durable broker",
          );
          assert.equal(job.result?.status, "completed");
          assert.equal(job.result?.runId, row.resultId);
        }
        assert.ok(
          rows.every((row) => row.state === "finished" && row.generation === 1),
        );
        assert.equal(
          new Set(rows.map((row) => reviewRequestKey(row.identity))).size,
          rows.length,
        );
        assert.deepEqual(failures, []);
        t.diagnostic(
          JSON.stringify({
            mask,
            enabled: fields.filter(enabled),
            calls: calls.length,
            serviceJobs: expectedJobs,
            requests: rows.map((row) => ({
              reasons: row.reasons,
              sourceKind: row.identity.source.kind,
            })),
          }),
        );
      } finally {
        requests.close();
      }
    },
  );
}
