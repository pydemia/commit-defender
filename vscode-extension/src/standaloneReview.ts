import path from "node:path";
import {
  projectCommitDefender,
  centralConnectionReference,
  type LocalScope,
} from "@gcr/client-contract";
import {
  CentralConnections,
  defaultLocalDataDirectory,
  resolveCentralContext,
  type CentralCredentialStore,
  captureLocalSource,
  contentHash,
  discoverLocalIdentity,
  LocalHistoryStore,
  LocalKnowledgeStore,
  LocalRecordStore,
  resolveLocalContext,
  resolveLocalExecutionPolicy,
  runLocalReview,
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
    if (settings.provider !== "codex")
      throw new StandaloneReviewError("unsupported-provider");
    if (
      settings.model !== "gpt-6-astra" ||
      settings.reasoningEffort !== "xhigh"
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
    snapshot = captureLocalSource({
      cwd: request.repoRoot,
      kind: request.scope === "staged" ? "index" : "working-tree",
      paths: request.files,
      includeUntracked: request.scope === "staged" ? [] : request.files,
      excludePatterns: settings.excludePatterns,
    });
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
    let central: Awaited<ReturnType<CentralConnections["review"]>> | undefined;
    if (settings.mode === "centralized") {
      connections = await CentralConnections.open({
        scope: repositoryScope,
        ...ports,
      });
      const status = await connections.status(settings.connectionId!);
      if (status.clientId !== "commit-defender")
        throw new StandaloneReviewError("authentication-required");
      central = await connections.review(
        settings.connectionId!,
        settings.freshness!,
        signal,
      );
      // Preserve authorization diagnostics before the context resolver reports
      // an unavailable context. The resolver still revalidates its pinned snapshot.
      await central.cache.read(central.freshness);
      client = central.client;
    }
    const context = central
      ? await resolveCentralContext({ ...query, ...central })
      : await resolveLocalContext(query);
    checkAbort(signal);
    if (context.status !== "ready")
      throw new StandaloneReviewError("needs-context");
    let executor: LocalReviewExecutor;
    try {
      executor = await (ports.prepareExecutor ?? prepareCodexAccountExecutor)({
        executablePath: settings.executablePath,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
      });
    } catch {
      checkAbort(signal);
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
    }
    return {
      backendId: settings.mode,
      key: contentHash({ identity: policy.identity, scope: request.scope }),
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
              : "Captured source and local context",
          );
          const report = await runLocalReview({
            snapshot: fixedSnapshot,
            context: context.context,
            policy,
            executor,
            signal: runSignal,
          });
          let diagnostic = "";
          try {
            const saved = await history.saveReview(report);
            if (saved.retentionPending)
              diagnostic =
                "Review saved; encrypted history retention cleanup remains pending.";
          } catch {
            diagnostic =
              "The displayed review could not be confirmed in encrypted history. Export the report before closing it.";
          }
          return {
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
