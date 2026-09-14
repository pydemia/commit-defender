import path from "node:path";
import {
  centralConnectionReference,
  offlineBehavior,
  type OfflineBehavior,
  type LocalScope,
} from "@gcr/client-contract";
import {
  CentralConnections,
  LocalRecordStore,
  LocalHistoryStore,
  contentHash,
  defaultLocalDataDirectory,
  type CentralCredentialStore,
} from "@gcr/client-core";
import {
  knowledgeScope,
  readLocalHistory,
  type KnowledgeLocation,
  type LocalStoragePorts,
} from "./localKnowledge.js";
import {
  StandaloneReviewError,
  type StandaloneReviewSettings,
} from "./standaloneReviewProtocol.js";

export type CentralSelection =
  | { version: 1; mode: "standalone" }
  | {
      version: 1;
      mode: "centralized";
      connectionId: string;
      freshness: "online" | "offline";
      offlineBehavior?: OfflineBehavior;
    };
export interface SelectionStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}
export function selectionKey(scope: LocalScope): string {
  if (scope.kind !== "repository")
    throw new StandaloneReviewError("central-connection-required");
  return `central-review.v1.${contentHash(scope)}`;
}
export function centralSelection(value: unknown): CentralSelection {
  if (!value || typeof value !== "object")
    throw new StandaloneReviewError("central-connection-required");
  const v = value as Record<string, unknown>;
  const fields =
    v.mode === "standalone"
      ? ["version", "mode"]
      : ["version", "mode", "connectionId", "freshness", "offlineBehavior"];
  if (v.version !== 1 || Object.keys(v).some((k) => !fields.includes(k)))
    throw new StandaloneReviewError("central-connection-required");
  if (v.mode === "standalone") return { version: 1, mode: "standalone" };
  if (
    v.mode !== "centralized" ||
    !["online", "offline"].includes(String(v.freshness))
  )
    throw new StandaloneReviewError("central-connection-required");
  return {
    version: 1,
    mode: "centralized",
    connectionId: centralConnectionReference(v.connectionId),
    freshness: v.freshness as "online" | "offline",
    ...(v.offlineBehavior === undefined
      ? {}
      : { offlineBehavior: offlineBehavior(v.offlineBehavior) }),
  };
}
export function readSelection(
  store: SelectionStore,
  scope: LocalScope,
): CentralSelection | undefined {
  const value = store.get(selectionKey(scope));
  return value === undefined ? undefined : centralSelection(value);
}
export function selectedReviewSettings(
  settings: StandaloneReviewSettings,
  selection?: CentralSelection,
): StandaloneReviewSettings {
  if (!selection) return settings;
  const checked = centralSelection(selection);
  return checked.mode === "standalone"
    ? {
        ...settings,
        mode: "standalone",
        connectionId: undefined,
        freshness: undefined,
        offlineBehavior: undefined,
      }
    : {
        ...settings,
        mode: "centralized",
        connectionId: checked.connectionId,
        freshness: checked.freshness,
        offlineBehavior: checked.offlineBehavior ?? "pause",
      };
}
export type CentralPorts = LocalStoragePorts & {
  credentials?: CentralCredentialStore;
  repositoryRoot?: string;
};
export async function withCentralConnection<T>(
  scope: LocalScope,
  work: (manager: CentralConnections) => Promise<T>,
  ports: CentralPorts = {},
): Promise<T> {
  const manager = await CentralConnections.open({ scope, ...ports });
  try {
    return await work(manager);
  } finally {
    manager.close();
  }
}
export async function readCentralHistory(
  location: KnowledgeLocation,
  selection: Extract<CentralSelection, { mode: "centralized" }>,
  ports: CentralPorts = {},
) {
  const scope = knowledgeScope(location);
  return withCentralConnection(
    scope,
    async (manager) => {
      const status = await manager.status(selection.connectionId);
      if (status.clientId !== "commit-defender")
        throw new StandaloneReviewError("authentication-required");
      const identity = await manager.historyIdentity(selection.connectionId);
      const records = await LocalRecordStore.open({
        scope,
        ...(ports.keys ? { keys: ports.keys } : {}),
        dataDirectory: path.join(
          ports.dataDirectory ?? defaultLocalDataDirectory(),
          "central-review-history",
          identity.id,
        ),
      });
      try {
        return {
          audience: identity.audience,
          reports: await new LocalHistoryStore(
            records,
            undefined,
            identity.audience,
          ).listReviews(),
        };
      } finally {
        records.close();
      }
    },
    {
      ...ports,
      ...(location.repoRoot ? { repositoryRoot: location.repoRoot } : {}),
    },
  );
}

/** Local fallback reports retain local ownership even after central access expires. */
export async function readSelectedHistory(
  location: KnowledgeLocation,
  selection?: CentralSelection,
  ports: CentralPorts = {},
) {
  const local = await readLocalHistory(location, ports);
  if (selection?.mode !== "centralized") return { reports: local };
  let central: Awaited<ReturnType<typeof readCentralHistory>> | undefined;
  try {
    central = await readCentralHistory(location, selection, ports);
  } catch {
    /* Show only owned local fallback history while central history is unavailable. */
  }
  return {
    reports: [
      ...(central?.reports ?? []),
      ...local.filter(
        (report) =>
          report.identity.client.execution?.connectionId ===
          selection.connectionId,
      ),
    ],
    audience: central?.audience,
    fallbackConnectionId: selection.connectionId,
  };
}
