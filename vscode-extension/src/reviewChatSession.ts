import path from "node:path";
import {
  CentralConnections,
  LocalRecordStore,
  LocalKnowledgeStore,
  ReviewConversationStore,
  restoreLocalSource,
  discoverLocalIdentity,
  defaultLocalDataDirectory,
  resolveReviewExecution,
  resolveLocalContext,
  resolveCentralContext,
  resolveLocalExecutionPolicy,
  runReviewConversation,
  contentHash,
  type LocalReviewChatExecutor,
  type LocalReviewExecutor,
  type StoredReviewConversation,
} from "@gcr/client-core";
import type {
  CentralAudience,
  LocalScope,
  ClientIdentity,
} from "@gcr/client-contract";
import { prepareCodexAccountExecutor } from "@gcr/client-executors";
import type { StandaloneReviewSettings } from "./standaloneReviewProtocol.js";
import type { StandaloneReviewPorts } from "./standaloneReview.js";
import {
  ReviewChatError,
  type ReviewChatAction,
  type ReviewChatResult,
  type ReviewChatTarget,
} from "./reviewChatProtocol.js";

/** Runs in a worker with host-selected settings. Target/action never carry credentials,
 * source paths, a source payload, or executable/permission overrides from the webview. */
export async function reviewChatOperation(
  target: ReviewChatTarget,
  action: ReviewChatAction,
  settings: StandaloneReviewSettings,
  signal: AbortSignal,
  progress: (message: string) => void = () => {},
  ports: StandaloneReviewPorts = {},
): Promise<ReviewChatResult> {
  const opened: LocalRecordStore[] = [];
  let connections: CentralConnections | undefined;
  let snapshot: ReturnType<typeof restoreLocalSource> | undefined;
  const assertActive = () => {
    if (signal.aborted) throw new ReviewChatError("cancelled");
    if (!settings.workspaceTrusted)
      throw new ReviewChatError("policy-unavailable");
  };
  try {
    assertActive();
    const localClient = discoverLocalIdentity(
      target.repoRoot,
      settings.profileId,
    );
    const scope: LocalScope = {
      kind: "repository",
      profileId: localClient.profileId,
      repositoryKey: localClient.repositoryKey,
      worktreeKey: localClient.worktreeKey,
    };
    const storageOptions = {
      ...(ports.keys ? { keys: ports.keys } : {}),
      ...(ports.dataDirectory ? { dataDirectory: ports.dataDirectory } : {}),
    };
    let historyDirectory = ports.dataDirectory ?? defaultLocalDataDirectory();
    let audience: CentralAudience | undefined;
    if (target.mode === "centralized") {
      if (settings.mode !== "centralized" || !settings.connectionId)
        throw new ReviewChatError("selection-changed");
      connections = await CentralConnections.open({ scope, ...ports });
      if (
        (await connections.status(settings.connectionId)).clientId !==
        "commit-defender"
      )
        throw new ReviewChatError("selection-changed");
      const identity = await connections.historyIdentity(settings.connectionId);
      audience = identity.audience;
      historyDirectory = path.join(
        historyDirectory,
        "central-review-history",
        identity.id,
      );
    }
    const records = await LocalRecordStore.open({
      scope,
      ...storageOptions,
      dataDirectory: historyDirectory,
    });
    opened.push(records);
    const store = new ReviewConversationStore(records, undefined, audience);
    const selected = (stored: StoredReviewConversation) => {
      assertActive();
      const client = stored.conversation.identity.client;
      if (
        client.mode !== target.mode ||
        (settings.mode === "centralized"
          ? client.execution?.connectionId !== settings.connectionId
          : client.execution?.configuredMode === "centralized")
      )
        throw new ReviewChatError("selection-changed");
    };
    let stored = await store.get(target.reportId);
    selected(stored);
    await store.prune();
    stored = await store.get(target.reportId);
    const state = (value: StoredReviewConversation): ReviewChatResult => ({
      type: "state",
      state: { conversation: value.conversation, review: value.review },
    });
    if (action.type === "read") return state(stored);
    if (action.type === "cancel")
      return state(await store.cancel(target.reportId, action.turnId));
    if (action.type === "source") {
      if (!Number.isInteger(action.citation) || action.citation < 0)
        throw new ReviewChatError("invalid-state");
      const citation = stored.conversation.turns.find(
        (turn) => turn.id === action.turnId,
      )?.response?.citations[action.citation];
      if (!citation) throw new ReviewChatError("invalid-state");
      snapshot = restoreLocalSource(stored.source);
      const read = snapshot.readFile(
        citation.location.path,
        citation.location.side,
      );
      if (
        read.status !== "available" ||
        read.source.hash !== citation.location.hash
      )
        throw new ReviewChatError("stale-identity");
      return {
        type: "source",
        content: read.text,
        path: citation.location.path,
        side: citation.location.side,
        line: citation.location.startLine,
      };
    }
    if (
      settings.provider !== "codex" ||
      settings.model !== "gpt-6-astra" ||
      settings.reasoningEffort !== "xhigh" ||
      contentHash(settings.excludePatterns) !==
        contentHash(stored.source.excludePatterns) ||
      settings.durationMs < stored.conversation.limits.durationMs
    )
      throw new ReviewChatError("stale-identity");
    snapshot = restoreLocalSource(stored.source);
    const knowledge: LocalKnowledgeStore[] = [];
    for (const localScope of [
      scope,
      { kind: "profile", profileId: settings.profileId } as const,
    ]) {
      const local = await LocalRecordStore.open({
        scope: localScope,
        ...storageOptions,
      });
      opened.push(local);
      knowledge.push(new LocalKnowledgeStore(local));
    }
    progress(
      "Checking the saved source, current review context, and selected account…",
    );
    const execution = await resolveReviewExecution({
      client: localClient,
      configuredMode: settings.mode as "standalone" | "centralized",
      offlineBehavior: settings.offlineBehavior ?? "pause",
      signal,
      ...(settings.mode === "centralized"
        ? {
            connectionId: settings.connectionId!,
            freshness: settings.freshness!,
            central: async (freshness) => {
              connections ??= await CentralConnections.open({
                scope,
                ...ports,
                repositoryRoot: target.repoRoot,
              });
              if (
                (await connections.status(settings.connectionId!)).clientId !==
                "commit-defender"
              )
                throw new ReviewChatError("selection-changed");
              return connections.review(
                settings.connectionId!,
                freshness,
                signal,
              );
            },
          }
        : {}),
    });
    const pinnedClient = stored.conversation.identity.client;
    const admissionIdentity = (client: ClientIdentity) => {
      const copy = structuredClone(client);
      if (copy.execution) delete copy.execution.lastSynchronizedAt;
      return copy;
    };
    // A successful refresh of the same publication only changes this observation
    // timestamp. Preserve the original review provenance after checking every
    // authority/mode field against the newly resolved selection. The fresh cache
    // authority and complete context identity still gate the resumed execution.
    if (
      contentHash(admissionIdentity(execution.client)) !==
      contentHash(admissionIdentity(pinnedClient))
    )
      throw new ReviewChatError("stale-identity");
    const query = { client: pinnedClient, snapshot, stores: knowledge };
    const context =
      execution.central && pinnedClient.mode === "centralized"
        ? await resolveCentralContext({
            ...query,
            ...execution.central,
            client: pinnedClient,
          })
        : await resolveLocalContext(query);
    if (context.status !== "ready")
      throw new ReviewChatError("policy-unavailable");
    const executor: LocalReviewExecutor = await (
      ports.prepareExecutor ?? prepareCodexAccountExecutor
    )({
      executablePath: settings.executablePath,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
    });
    if (
      !("conversationCapability" in executor) ||
      executor.conversationCapability !== "checkpoint-tool-v1" ||
      !("converse" in executor) ||
      typeof executor.converse !== "function"
    )
      throw new ReviewChatError("policy-unavailable");
    const chatExecutor = executor as LocalReviewChatExecutor;
    const resolution = resolveLocalExecutionPolicy({
      context,
      snapshot,
      executor: executor.descriptor,
      workspaceTrusted: settings.workspaceTrusted,
      approval: {
        client: context.context.client,
        executor: executor.descriptor,
        sourceHash: snapshot.identity.hash,
        paths: ["**"],
        allowBase: true,
        allowRelated: true,
        allowKnowledge: true,
      },
      budget: stored.conversation.limits,
    });
    if (
      resolution.status !== "ready" ||
      contentHash(resolution.policy.identity) !==
        contentHash(stored.conversation.identity)
    )
      throw new ReviewChatError("stale-identity");
    assertActive();
    if (action.type === "send")
      stored = await store.append(
        target.reportId,
        action.turnId,
        action.content,
      );
    else if (action.type === "answer")
      stored = await store.answer(
        target.reportId,
        action.turnId,
        action.questionId,
        action.content,
      );
    progress("Reading the fixed source and preparing an answer…");
    const result = await runReviewConversation({
      store,
      conversationId: target.reportId,
      turnId: action.turnId,
      context: context.context,
      policy: resolution.policy,
      executor: {
        descriptor: executor.descriptor,
        conversationCapability: "checkpoint-tool-v1",
        review: (input) => executor.review(input),
        converse: (input) =>
          chatExecutor.converse({
            ...input,
            source: {
              async execute(name, args) {
                const text = await input.source.execute(name, args);
                if (name === "read_file") {
                  const read = JSON.parse(text);
                  if (read.status === "available")
                    progress(`Read ${read.source.side}: ${read.source.path}`);
                }
                return text;
              },
            },
          }),
      },
      signal,
      async assertAuthorized() {
        assertActive();
        selected(await store.get(target.reportId));
      },
    });
    await store.prune();
    return state(result);
  } finally {
    snapshot?.close();
    connections?.close();
    for (const records of opened) records.close();
  }
}
