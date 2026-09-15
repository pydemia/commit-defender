import path from "node:path";
import { prepareLocalProviderExecutor } from "./localProviderExecutor.js";
import { createHash } from "node:crypto";
import {
  projectCommitDefender,
  centralConnectionReference,
  type LocalScope,
  type ClientReviewReport,
} from "@gcr/client-contract";
import {
  CentralConnections,
  resolveReviewExecution,
  defaultLocalDataDirectory,
  resolveCentralContext,
  type CentralCredentialStore,
  captureLocalSource,
  reviewRequestKey,
  executeReviewRequest,
  ReviewRequestError,
  observeAutomaticRepository,
  observeAutomaticFile,
  discoverLocalIdentity,
  LocalHistoryStore,
  ReviewConversationStore,
  ReviewConversationError,
  LocalKnowledgeStore,
  LocalRecordStore,
  resolveLocalContext,
  resolveLocalExecutionPolicy,
  runLocalReview,
  loadSelectedSourceHistory,
  type LocalKeyStore,
  type LocalReviewExecutor,
  type LocalSourceSnapshot,
} from "@gcr/client-core";
import { prepareCodexAccountExecutor } from "@gcr/client-executors";
import type { PreparedExecution, ReviewRequest } from "./reviewBackend.js";
import type { RunResult } from "./types.js";
import {
  StandaloneReviewError,
  standaloneError,
  type StandaloneReviewSettings,
} from "./standaloneReviewProtocol.js";

/** Application ports for tests; these are not settings, worker messages or environment overrides. */
export interface StandaloneReviewPorts {
  dataDirectory?: string;
  keys?: LocalKeyStore;
  credentials?: CentralCredentialStore;
  prepareExecutor?:
    | typeof prepareCodexAccountExecutor
    | ((
        options: Parameters<typeof prepareCodexAccountExecutor>[0],
      ) => Promise<LocalReviewExecutor>);
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted)
    throw new StandaloneReviewError(
      signal.reason === "timeout" ? "timeout" : "cancelled",
    );
}

/** Owns factory-created core objects in one worker. No snapshot is reconstructed from JSON. */
export async function prepareStandaloneReview(
  request: ReviewRequest,
  settings: StandaloneReviewSettings,
  signal: AbortSignal,
  ports: StandaloneReviewPorts = {},
): Promise<PreparedExecution<RunResult> & { dispose(): void }> {
  let snapshot: LocalSourceSnapshot | undefined;
  const opened: LocalRecordStore[] = [];
  let connections: CentralConnections | undefined;
  let disposed = false;
  let running = false;
  const dispose = () => {
    if (running)
      throw new Error("Cannot release an executing review before it settles.");
    if (disposed) return;
    disposed = true;
    snapshot?.close();
    connections?.close();
    for (const records of opened) records.close();
  };
  try {
    checkAbort(signal);
    if (!["standalone", "centralized"].includes(settings.mode))
      throw new StandaloneReviewError("unsupported-mode");
    if (
      settings.requiredCentralSnapshot !== undefined &&
      (typeof settings.requiredCentralSnapshot !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(
          settings.requiredCentralSnapshot,
        ) ||
        settings.mode !== "centralized" ||
        settings.offlineBehavior !== "pause")
    )
      throw new StandaloneReviewError("central-snapshot-changed");
    if (settings.mode === "centralized") {
      if (!settings.connectionId)
        throw new StandaloneReviewError("central-connection-required");
      centralConnectionReference(settings.connectionId);
      if (settings.freshness !== "online" && settings.freshness !== "offline")
        throw new StandaloneReviewError("central-connection-required");
    }
    if (!settings.workspaceTrusted)
      throw new StandaloneReviewError("untrusted-workspace");
    if (settings.provider === "unconfigured")
      throw new StandaloneReviewError("account-not-configured");
    if (!["codex", "aoai", "openai", "anthropic", "gemini"].includes(settings.provider))
      throw new StandaloneReviewError("unsupported-provider");
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(settings.model) ||
      (settings.reasoningEffort !== "" && !["none", "minimal", "low", "medium", "high", "xhigh"].includes(settings.reasoningEffort))
    )
      throw new StandaloneReviewError("executor-unavailable");
    if (!request.files.length) throw new StandaloneReviewError("no-source");
    const localClient = discoverLocalIdentity(
      request.repoRoot,
      settings.profileId,
    );
    let client = localClient;
    const repositoryScope: LocalScope = {
      kind: "repository",
      profileId: client.profileId,
      repositoryKey: client.repositoryKey,
      worktreeKey: client.worktreeKey,
    };
    const automatic = request.automatic;
    if (
      automatic &&
      (!["save", "stage"].includes(automatic.reason) ||
        !Number.isInteger(automatic.minimumIntervalMs) ||
        automatic.minimumIntervalMs < 0 ||
        automatic.minimumIntervalMs > 3600000 ||
        !Number.isInteger(automatic.maximumReviewsPerHour) ||
        automatic.maximumReviewsPerHour < 1 ||
        automatic.maximumReviewsPerHour > 100 ||
        (automatic.reason === "stage" &&
          (!automatic.indexFingerprint || request.scope !== "staged")) ||
        (automatic.reason === "save" &&
          (!automatic.files ||
            request.files.some((file) => !(file in automatic.files!)))))
    )
      throw new StandaloneReviewError("policy-unavailable");
    const assertAutomaticSource = async () => {
      if (!automatic) return;
      const current = await observeAutomaticRepository(
        request.repoRoot,
        settings.excludePatterns,
      );
      if (
        current.head !== automatic.head ||
        (automatic.reason === "stage" &&
          current.fingerprint !== automatic.indexFingerprint)
      )
        throw new StandaloneReviewError("source-changed");
      if (automatic.reason === "save") {
        for (const file of request.files) {
          const observed = await observeAutomaticFile(
            current.root,
            file,
            settings.excludePatterns,
          );
          if (!observed || observed.hash !== automatic.files![file])
            throw new StandaloneReviewError("source-changed");
        }
      }
      return current;
    };
    const automaticSource = await assertAutomaticSource();
    checkAbort(signal);
    snapshot = captureLocalSource({
      cwd: request.repoRoot,
      kind: request.scope === "staged" ? "index" : "working-tree",
      paths: request.files,
      includeUntracked: request.scope === "staged" ? [] : request.files,
      excludePatterns: settings.excludePatterns,
    });
    await assertAutomaticSource();
    if (automatic && automaticSource) {
      for (const selected of snapshot.selected) {
        const read = snapshot.readFile(selected.path, "source");
        if (automatic.reason === "save") {
          const hash = read.status === "available" ? read.source.hash : null;
          if (hash !== automatic.files![selected.path])
            throw new StandaloneReviewError("source-changed");
        } else {
          const expected = automaticSource.changes.find(
            (c) => c.path === selected.path,
          );
          if (!expected) throw new StandaloneReviewError("source-changed");
          if (read.status === "available") {
            const bytes = Buffer.from(read.text, "utf8");
            const oid = createHash(snapshot.identity.objectFormat)
              .update(`blob ${bytes.length}\0`)
              .update(bytes)
              .digest("hex");
            if (oid !== expected.oid)
              throw new StandaloneReviewError("source-changed");
          } else if (expected.status !== "D")
            throw new StandaloneReviewError("source-changed");
        }
      }
    }
    checkAbort(signal);
    if (!snapshot.selected.length) throw new StandaloneReviewError("no-source");
    for (const scope of [
      repositoryScope,
      { kind: "profile", profileId: client.profileId } as const,
    ]) {
      const records = await LocalRecordStore.open({
        scope,
        ...(ports.dataDirectory ? { dataDirectory: ports.dataDirectory } : {}),
        ...(ports.keys ? { keys: ports.keys } : {}),
      });
      opened.push(records);
      checkAbort(signal);
    }
    const query = {
      client,
      snapshot,
      stores: opened.map((records) => new LocalKnowledgeStore(records)),
    };
    const resolved = await resolveReviewExecution({
      client: localClient,
      configuredMode: settings.mode as "standalone" | "centralized",
      offlineBehavior: settings.offlineBehavior ?? "pause",
      ...(settings.mode === "centralized"
        ? {
            connectionId: settings.connectionId!,
            freshness: settings.freshness!,
            central: async (freshness) => {
              connections ??= await CentralConnections.open({
                scope: repositoryScope,
                ...ports,
                repositoryRoot: request.repoRoot,
              });
              const status = await connections.status(settings.connectionId!);
              if (status.clientId !== "commit-defender")
                throw new StandaloneReviewError("authentication-required");
              return connections.review(
                settings.connectionId!,
                freshness,
                signal,
              );
            },
          }
        : {}),
      signal,
    });
    const central = resolved.central;
    client = resolved.client;
    const context = central
      ? await resolveCentralContext({ ...query, ...central,
          loadSourceHistory: selection => loadSelectedSourceHistory(selection, request => connections!.readHistory(settings.connectionId!, request, central.freshness, signal)),
        })
      : await resolveLocalContext({ ...query, client });
    checkAbort(signal);
    if (context.status !== "ready")
      throw new StandaloneReviewError("needs-context");
    if (
      settings.requiredCentralSnapshot &&
      context.context.identity.centralSnapshot?.id !==
        settings.requiredCentralSnapshot
    )
      throw new StandaloneReviewError("central-snapshot-changed");
    let executor: LocalReviewExecutor;
    try {
      executor = ports.prepareExecutor ? await ports.prepareExecutor({ executablePath: settings.executablePath, model: settings.model, reasoningEffort: settings.reasoningEffort }) : await prepareLocalProviderExecutor(settings, ports);
    } catch (error) {
      checkAbort(signal);
      if (error instanceof StandaloneReviewError) throw error;
      throw new StandaloneReviewError("executor-unavailable");
    }
    checkAbort(signal);
    const resolution = resolveLocalExecutionPolicy({
      context,
      snapshot,
      executor: executor.descriptor,
      workspaceTrusted: settings.workspaceTrusted,
      // The explicit review command admits captured repository source/base/related context
      // and active personal knowledge. Repository content cannot change these grants.
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
    if (resolution.status !== "ready")
      throw new StandaloneReviewError("policy-unavailable");
    const fixedSnapshot = snapshot;
    const policy = resolution.policy;
    let history = new LocalHistoryStore(opened[0]);
    let conversations = new ReviewConversationStore(opened[0]);
    if (central) {
      const identity = await connections!.historyIdentity(
        settings.connectionId!,
      );
      const records = await LocalRecordStore.open({
        scope: repositoryScope,
        ...(ports.keys ? { keys: ports.keys } : {}),
        dataDirectory: path.join(
          ports.dataDirectory ?? defaultLocalDataDirectory(),
          "central-review-history",
          identity.id,
        ),
      });
      opened.push(records);
      history = new LocalHistoryStore(records, undefined, identity.audience);
      conversations = new ReviewConversationStore(
        records,
        undefined,
        identity.audience,
      );
    }
    return {
      backendId: client.mode,
      key: reviewRequestKey(policy.identity),
      dispose,
      async run(runSignal, progress) {
        if (disposed || running) throw new StandaloneReviewError("disposed");
        running = true;
        try {
          progress?.(
            0,
            fixedSnapshot.selected.length,
            central
              ? "Captured source and verified central/local context"
              : resolved.execution.fallbackReason
                ? `Standalone fallback: ${resolved.execution.fallbackReason}`
                : "Captured source and local context",
          );
          let diagnostic = "";
          const runReview = (signal: AbortSignal) =>
            runLocalReview({
              snapshot: fixedSnapshot,
              context: context.context,
              policy,
              executor,
              signal,
              ...(automatic ? { trigger: automatic.reason } : {}),
            });
          const saveReport = async (report: ClientReviewReport) => {
            const saved = await history.saveReview(report);
            if (saved.retentionPending)
              diagnostic =
                "Review saved; encrypted history retention cleanup remains pending.";
          };
          let report: ClientReviewReport;
          let reviewCompletionConfirmed = false;
          try {
            const result = await executeReviewRequest({
              storage: {
                scope: repositoryScope,
                ...(ports.dataDirectory
                  ? { dataDirectory: ports.dataDirectory }
                  : {}),
                ...(ports.keys ? { keys: ports.keys } : {}),
              },
              identity: policy.identity,
              signal: runSignal,
              ...(automatic
                ? {
                    reason: automatic.reason,
                    limits: {
                      minimumIntervalMs: automatic.minimumIntervalMs,
                      maximumReviewsPerHour: automatic.maximumReviewsPerHour,
                    },
                  }
                : {}),
              assertValid: async () => {
                await assertAutomaticSource();
                if (
                  (await context.context.observeCentralSnapshot()) !== "current"
                )
                  throw new ReviewRequestError("request-invalid");
              },
              loadReport: (id) => history.getReview(id),
              saveReport,
              run: runReview,
            });
            report = result.report;
            reviewCompletionConfirmed = result.persisted && result.recorded;
            if (!result.persisted)
              diagnostic =
                "The displayed review could not be confirmed in encrypted history. Export the report before closing it.";
            else if (!result.recorded)
              diagnostic =
                "The report was saved, but request completion could not be confirmed. Inspect the saved report and request state before retrying.";
            else if (result.reused)
              diagnostic =
                "Reused the saved review for identical source, context and executor settings. No model review was started.";
          } catch (error) {
            if (!runSignal.aborted) throw error;
            // A cancelled caller owns no shared execution. The runner creates a
            // terminal cancellation/timeout report without invoking the model;
            // saving that attempt must not finish another caller's request.
            report = await runReview(runSignal);
            try {
              await saveReport(report);
            } catch {
              diagnostic =
                "The cancelled attempt could not be confirmed in encrypted history.";
            }
          }
          if (
            ["completed", "partial", "needs-context"].includes(report.status)
          ) {
            try {
              try {
                await conversations.get(report.runId);
              } catch (error) {
                if (
                  !(error instanceof ReviewConversationError) ||
                  error.code !== "missing"
                )
                  throw error;
                await conversations.create({
                  id: report.runId,
                  review: report,
                  snapshot: fixedSnapshot,
                  policy,
                });
              }
              await conversations.prune();
            } catch {
              diagnostic +=
                " The review is available, but its conversation snapshot could not be saved.";
            }
          }
          return {
            reviewCompletionConfirmed,
            report: projectCommitDefender(report),
            capturedSources: Object.fromEntries(
              report.files.flatMap(({ source }) => {
                const read = fixedSnapshot.readFile(source.path, source.side);
                return read.status === "available"
                  ? [[source.path, read.text]]
                  : [];
              }),
            ),
            stderr: diagnostic,
            timedOut: report.problems.some(
              (problem) => problem.code === "timeout",
            ),
            cancelled: report.status === "cancelled",
          };
        } finally {
          running = false;
          dispose();
        }
      },
    };
  } catch (error) {
    dispose();
    throw standaloneError(error);
  }
}
