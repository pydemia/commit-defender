import {
  type LocalScope,
  type LocalKnowledge,
  type ClientReviewReport,
} from "@gcr/client-contract";
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  discoverLocalIdentity,
  LocalKnowledgeStore,
  LocalRecordStore,
  LocalHistoryStore,
  type LocalKeyStore,
  type LocalKnowledgeDraft,
  canonicalJson,
  defaultLocalDataDirectory,
} from "@gcr/client-core";
import {
  knowledgeEditorChanges,
  knowledgeEditorValues,
} from "./localKnowledgeEditor.js";

export interface KnowledgeLocation {
  profileId: string;
  repoRoot?: string;
  scope: "profile" | "repository";
}
export interface LocalStoragePorts {
  dataDirectory?: string;
  keys?: LocalKeyStore;
}

export function knowledgeScope(location: KnowledgeLocation): LocalScope {
  if (location.scope === "profile")
    return { kind: "profile", profileId: location.profileId };
  if (!location.repoRoot)
    throw new Error("Open a Git worktree to manage repository knowledge.");
  const client = discoverLocalIdentity(location.repoRoot, location.profileId);
  return {
    kind: "repository",
    profileId: client.profileId,
    repositoryKey: client.repositoryKey,
    worktreeKey: client.worktreeKey,
  };
}

/** Each operation reopens authenticated records so another CLI/extension process is visible. */
export async function withLocalKnowledge<T>(
  scope: LocalScope,
  operation: (store: LocalKnowledgeStore) => Promise<T>,
  ports: LocalStoragePorts = {},
): Promise<T> {
  const records = await LocalRecordStore.open({ scope, ...ports });
  try {
    return await operation(new LocalKnowledgeStore(records));
  } finally {
    records.close();
  }
}

/** Save exactly the revision shown by the editor, preserving core CAS and scope checks. */
export async function saveKnowledgeFromEditor(
  scope: LocalScope,
  kind: LocalKnowledge["kind"],
  value: unknown,
  expected?: LocalKnowledge,
  ports: LocalStoragePorts = {},
): Promise<LocalKnowledge> {
  const update = knowledgeEditorChanges(knowledgeEditorValues(value), kind);
  if (expected) {
    if (
      expected.kind !== kind ||
      canonicalJson(expected.scope) !== canonicalJson(scope)
    )
      throw Error("Editor scope no longer matches the selected entry.");
    return withLocalKnowledge(
      scope,
      (store) => store.edit(expected.id, expected.revision, update),
      ports,
    );
  }
  const common = {
    title: update.title!,
    body: update.body!,
    appliesTo: update.appliesTo!,
    sources: [{ kind: "user-note" as const, id: randomUUID() }],
    ...(update.expiresAt ? { expiresAt: update.expiresAt } : {}),
  };
  const draft: LocalKnowledgeDraft =
    kind === "memory"
      ? {
          ...common,
          kind,
          rationale: update.rationale ?? "",
          counterEvidence: update.counterEvidence ?? [],
        }
      : { ...common, kind, reviewOnly: true, origin: "user-authored" };
  return withLocalKnowledge(scope, (store) => store.create(draft), ports);
}

export async function readLocalHistory(
  location: KnowledgeLocation,
  ports: LocalStoragePorts = {},
): Promise<ClientReviewReport[]> {
  const scope = knowledgeScope(location);
  // An empty installation has no history to decrypt. Do not create a key merely to render an empty sidebar.
  const dataDirectory = ports.dataDirectory ?? defaultLocalDataDirectory();
  try {
    await lstat(path.join(dataDirectory, "profiles", scope.profileId));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return [];
    throw error;
  }
  const records = await LocalRecordStore.open({
    scope,
    ...ports,
  });
  try {
    return await new LocalHistoryStore(records).listReviews();
  } finally {
    records.close();
  }
}

export interface LocalContextFreshness {
  checkedAt: string;
  status: "current" | "stale" | "unavailable";
  changes: Array<{
    id: string;
    reason: "removed" | "inactive" | "expired" | "changed";
  }>;
}

/** Observes current personal records without altering a report's immutable context identity. */
export async function checkLocalContextFreshness(
  report: ClientReviewReport,
  ports: LocalStoragePorts = {},
  now = new Date(),
): Promise<LocalContextFreshness> {
  const result: LocalContextFreshness = {
    checkedAt: now.toISOString(),
    status: "current",
    changes: [],
  };
  const scopes = new Map<
    string,
    {
      scope: LocalScope;
      entries: Array<{ id: string; hash: string; revision: number }>;
    }
  >();
  for (const entry of report.identity.context.entries) {
    if (entry.origin !== "local") continue;
    const key = JSON.stringify(entry.scope);
    const group = scopes.get(key) ?? { scope: entry.scope, entries: [] };
    group.entries.push(entry);
    scopes.set(key, group);
  }
  try {
    for (const { scope, entries } of scopes.values()) {
      await withLocalKnowledge(
        scope,
        async (store) => {
          for (const entry of entries) {
            const current: LocalKnowledge | undefined = await store.get(
              entry.id,
            );
            const reason = !current
              ? "removed"
              : current.state !== "active"
                ? "inactive"
                : current.expiresAt &&
                    Date.parse(current.expiresAt) <= now.getTime()
                  ? "expired"
                  : current.hash !== entry.hash ||
                      current.revision !== entry.revision
                    ? "changed"
                    : undefined;
            if (reason) result.changes.push({ id: entry.id, reason });
          }
        },
        ports,
      );
    }
    if (result.changes.length) result.status = "stale";
  } catch {
    result.status = "unavailable";
  }
  return result;
}
