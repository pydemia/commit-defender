import { randomUUID } from "node:crypto";
import {
  projectCommitDefender,
  type RemoteReviewPayload,
  type RemoteReviewModels,
} from "@gcr/client-contract";
import {
  CentralConnections,
  RemoteReviewClient,
  captureLocalSource,
  discoverLocalIdentity,
  LocalRecordStore,
  LocalKnowledgeStore,
  resolveLocalContext,
  resolveCentralContext,
  prepareRemoteReview,
  type LocalSourceSnapshot,
} from "@gcr/client-core";
import type { ReviewRequest, PreparedExecution } from "./reviewBackend.js";
import type { StandaloneReviewSettings } from "./standaloneReviewProtocol.js";
import type { CentralPorts } from "./centralConnection.js";
import type { RunResult } from "./types.js";

export type RemoteModelChoice = {
  connectionId: string;
  accountId: string;
  name: string;
  reasoningEffort: RemoteReviewPayload["model"]["reasoningEffort"];
};
export type RemoteProposal = ReturnType<typeof prepareRemoteReview> & {
  serverUrl: string;
  catalog: RemoteReviewModels;
};
export class RemoteModelReviewError extends Error {
  constructor(
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(
      `Central review: ${code}.${requestId ? ` Request ${requestId}. Open Central Model Requests to inspect or cancel it.` : ""}`,
    );
    this.name = "RemoteModelReviewError";
  }
}
export async function prepareRemoteModelReview(
  request: ReviewRequest,
  settings: StandaloneReviewSettings,
  choice: RemoteModelChoice,
  signal: AbortSignal,
  approval: {
    confirm(
      proposal: RemoteProposal,
      signal: AbortSignal,
    ): Promise<string | undefined>;
    assertCurrent(): void;
  },
  ports: CentralPorts = {},
): Promise<PreparedExecution<RunResult>> {
  const opened: Array<{ close(): void }> = [];
  let snapshot: LocalSourceSnapshot | undefined;
  let disposed = false;
  const dispose = () => {
    if (!disposed) {
      disposed = true;
      snapshot?.close();
      opened.reverse().forEach((x) => x.close());
    }
  };
  const current = () => {
    approval.assertCurrent();
    if (signal.aborted)
      throw new RemoteModelReviewError("preparation-cancelled");
  };
  try {
    current();
    if (
      !settings.workspaceTrusted ||
      request.automatic ||
      !request.files.length
    )
      throw new RemoteModelReviewError("manual-trusted-review-required");
    if (
      !["standalone", "centralized"].includes(settings.mode) ||
      (settings.mode === "centralized" &&
        settings.connectionId !== choice.connectionId)
    )
      throw new RemoteModelReviewError("knowledge-connection-mismatch");
    const client = discoverLocalIdentity(request.repoRoot, settings.profileId);
    const scope = {
      kind: "repository" as const,
      profileId: client.profileId,
      repositoryKey: client.repositoryKey,
      worktreeKey: client.worktreeKey,
    };
    const manager = await CentralConnections.open({ scope, ...ports });
    opened.push(manager);
    const status = await manager.status(choice.connectionId);
    if (status.clientId !== "commit-defender" || status.status !== "connected")
      throw new RemoteModelReviewError("connection-unavailable");
    const catalog = await manager.remoteReviewModels(
      choice.connectionId,
      signal,
    );
    const model = catalog.models.find(
      (m) => m.accountId === choice.accountId && m.name === choice.name,
    );
    if (
      !catalog.enabled ||
      !model?.allowedEfforts.includes(choice.reasoningEffort)
    )
      throw new RemoteModelReviewError("model-no-longer-authorized");
    current();
    snapshot = captureLocalSource({
      cwd: request.repoRoot,
      kind: request.scope === "staged" ? "index" : "working-tree",
      paths: request.files,
      includeUntracked: request.scope === "staged" ? [] : request.files,
      excludePatterns: settings.excludePatterns,
    });
    const stores: LocalKnowledgeStore[] = [];
    for (const localScope of [
      scope,
      { kind: "profile" as const, profileId: client.profileId },
    ]) {
      const record = await LocalRecordStore.open({
        scope: localScope,
        ...ports,
      });
      opened.push(record);
      stores.push(new LocalKnowledgeStore(record));
    }
    const query = { client, snapshot, stores };
    const context =
      settings.mode === "centralized"
        ? await resolveCentralContext({
            ...query,
            ...(await manager.review(choice.connectionId, "online", signal)),
          })
        : await resolveLocalContext(query);
    if (
      context.status !== "ready" ||
      context.context.client.mode !== settings.mode
    )
      throw new RemoteModelReviewError("context-unavailable");
    if (
      settings.requiredCentralSnapshot &&
      context.context.identity.centralSnapshot?.id !==
        settings.requiredCentralSnapshot
    )
      throw new RemoteModelReviewError("central-snapshot-changed");
    current();
    const proposal = prepareRemoteReview({
      schemaVersion: 1,
      requestId: randomUUID(),
      audience: status.audience,
      clientId: "commit-defender",
      client: context.context.client,
      executor: "central",
      model: {
        accountId: choice.accountId,
        name: choice.name,
        reasoningEffort: choice.reasoningEffort,
      },
      snapshot,
      sourceFiles: snapshot.sourceFiles,
      context: context.context.toRemoteContext(),
      budget: {
        modelCalls: Math.min(4, catalog.limits.modelCalls),
        durationMs: Math.min(settings.durationMs, catalog.limits.durationMs),
        sourceBytes: 1048576,
        toolCalls: 100,
      },
      retention: { sourceSeconds: 3600, resultSeconds: 86400 },
    });
    const confirmed = await approval.confirm(
      { ...proposal, serverUrl: status.serverUrl, catalog },
      signal,
    );
    current();
    if (confirmed !== proposal.payloadHash)
      throw new RemoteModelReviewError("upload-not-approved");
    if ((await context.context.observeCentralSnapshot()) !== "current")
      throw new RemoteModelReviewError("context-changed");
    const approvedAt = new Date().toISOString();
    const remote = await RemoteReviewClient.open({
      scope,
      ...ports,
      connectionId: choice.connectionId,
      connections: manager,
    });
    opened.push(remote);
    const fixed = snapshot;
    return {
      backendId: "gcr-central-model",
      key: proposal.payloadHash,
      dispose,
      async run(runSignal, progress) {
        if (disposed) throw new RemoteModelReviewError("preparation-disposed");
        approval.assertCurrent();
        if (runSignal.aborted)
          throw new RemoteModelReviewError("execution-cancelled");
        const id = proposal.payload.requestId;
        try {
          progress?.(0, 1, "Submitting approved central review");
          await remote.submit(
            {
              payload: proposal.payload,
              approval: { payloadHash: confirmed, approvedAt },
            },
            runSignal,
          );
          progress?.(0, 1, `Central request ${id}`);
          const state = await remote.wait(id, {
            signal: runSignal,
            timeoutMs: 600000,
          });
          approval.assertCurrent();
          if (state.status?.state !== "completed")
            throw new RemoteModelReviewError(
              state.status?.state ?? "outcome-unconfirmed",
              id,
            );
          const result = await remote.result(id, runSignal);
          approval.assertCurrent();
          progress?.(1, 1, "Central review result verified");
          return {
            report: projectCommitDefender(result.report),
            reviewCompletionConfirmed: true,
            capturedSources: Object.fromEntries(
              result.report.files.flatMap(({ source }) => {
                const read = fixed.readFile(source.path, source.side);
                return read.status === "available"
                  ? [[source.path, read.text]]
                  : [];
              }),
            ),
            stderr:
              "Central execution result. Source-read receipts were produced by the server; no local model or test runner was invoked.",
            timedOut: false,
            cancelled: false,
          };
        } catch (error) {
          if (runSignal.aborted) {
            // An independent bounded credential operation records cancellation intent even though the local wait stopped.
            try {
              const cancelled = await remote.cancel(id);
              throw new RemoteModelReviewError(
                cancelled.status?.state ?? "cancellation-unconfirmed",
                id,
              );
            } catch (cancelError) {
              if (cancelError instanceof RemoteModelReviewError)
                throw cancelError;
              throw new RemoteModelReviewError("cancellation-unconfirmed", id);
            }
          }
          if (error instanceof RemoteModelReviewError) throw error;
          throw new RemoteModelReviewError("outcome-unconfirmed", id);
        }
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
