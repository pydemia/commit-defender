import path from "node:path";
import { lstat } from "node:fs/promises";
import {
  contentHash,
  defaultLocalDataDirectory,
  LocalRecordStore,
  LocalStoreError,
  newlyStagedPaths,
  type AutomaticRepository,
} from "@gcr/client-core";
import { sourcePath } from "@gcr/client-contract";
import { knowledgeScope, type LocalStoragePorts } from "./localKnowledge.js";

interface Checkpoint {
  version: 1;
  enabled: boolean;
  selection: string;
  observed: AutomaticRepository;
  pendingPaths: string[];
}
const id = "automatic-stage-observation-v1";
const invalid = () =>
  new Error("Saved automatic stage observation is invalid.");

/** A source observation is not an execution lease. Pending work is acknowledged
 * only after the existing review broker has returned a result. */
export class AutomaticStageCheckpoint {
  constructor(private readonly ports: LocalStoragePorts = {}) {}
  private async records<T>(
    root: string,
    profileId: string,
    create: boolean,
    work: (records: LocalRecordStore) => Promise<T>,
  ): Promise<T | undefined> {
    if (!create) {
      try {
        await lstat(
          path.join(
            this.ports.dataDirectory ?? defaultLocalDataDirectory(),
            "profiles",
            profileId,
          ),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
    }
    const scope = knowledgeScope({
      repoRoot: root,
      profileId,
      scope: "repository",
    });
    const records = await LocalRecordStore.open({ scope, ...this.ports });
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          return await work(records);
        } catch (error) {
          if (
            !(error instanceof LocalStoreError) ||
            error.code !== "revision-conflict"
          )
            throw error;
        }
      }
      throw new Error("Automatic stage observation is busy.");
    } finally {
      records.close();
    }
  }
  private decode(value: unknown, root: string): Checkpoint {
    if (!value || typeof value !== "object") throw invalid();
    const state = value as Checkpoint;
    if (
      state.version !== 1 ||
      typeof state.enabled !== "boolean" ||
      typeof state.selection !== "string" ||
      !/^[a-f0-9]{64}$/.test(state.selection) ||
      !state.observed ||
      state.observed.root !== root ||
      typeof state.observed.indexPath !== "string" ||
      (state.observed.head !== null &&
        (typeof state.observed.head !== "string" ||
          !/^[a-f0-9]{40,64}$/.test(state.observed.head))) ||
      typeof state.observed.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(state.observed.fingerprint) ||
      !Array.isArray(state.observed.changes) ||
      !Array.isArray(state.pendingPaths)
    )
      throw invalid();
    for (const change of state.observed.changes) {
      if (
        !change ||
        [
          change.path,
          change.status,
          change.oldOid,
          change.oid,
          change.oldMode,
          change.mode,
        ].some((v) => typeof v !== "string")
      )
        throw invalid();
      sourcePath(change.path);
      if (
        !/^[AMDTU]$/.test(change.status) ||
        !/^[a-f0-9]{40,64}$/.test(change.oldOid) ||
        !/^[a-f0-9]{40,64}$/.test(change.oid) ||
        !/^\d{6}$/.test(change.oldMode) ||
        !/^\d{6}$/.test(change.mode)
      )
        throw invalid();
    }
    if (
      new Set(state.pendingPaths).size !== state.pendingPaths.length ||
      state.pendingPaths.some(
        (file) => !state.observed.changes.some((c) => c.path === file),
      )
    )
      throw invalid();
    return state;
  }
  async observe(
    observed: AutomaticRepository,
    profileId: string,
    selection: string,
    enabled: boolean,
    current: () => boolean = () => true,
  ) {
    const next = await this.records(
      observed.root,
      profileId,
      enabled,
      async (records) => {
        const row = await records.read("settings", id);
        if (!current()) return false;
        const previous =
          row && !row.deleted
            ? this.decode(row.value, observed.root)
            : undefined;
        let pendingPaths: string[] = [];
        if (enabled && previous?.enabled && previous.selection === selection) {
          if (previous.observed.head !== observed.head) {
            // A different base invalidates the old request. Any retained index changes need their new base.
            pendingPaths = observed.changes.map((c) => c.path);
          } else {
            const retained = previous.pendingPaths.filter((file) =>
              observed.changes.some((c) => c.path === file),
            );
            pendingPaths = [
              ...new Set([
                ...retained,
                ...newlyStagedPaths(previous.observed, observed),
              ]),
            ].sort();
          }
        }
        const value: Checkpoint = {
          version: 1,
          enabled,
          selection,
          observed,
          pendingPaths,
        };
        this.decode(value, observed.root);
        if (!previous || contentHash(previous) !== contentHash(value))
          await records.write("settings", id, value, row?.revision ?? 0);
        return pendingPaths.length > 0;
      },
    );
    return next ?? false;
  }
  async acknowledge(
    root: string,
    profileId: string,
    selection: string,
    fingerprint: string,
  ) {
    await this.records(root, profileId, false, async (records) => {
      const row = await records.read("settings", id);
      if (!row || row.deleted) return;
      const state = this.decode(row.value, root);
      if (
        state.enabled &&
        state.selection === selection &&
        state.observed.fingerprint === fingerprint &&
        state.pendingPaths.length
      )
        await records.write(
          "settings",
          id,
          { ...state, pendingPaths: [] },
          row.revision,
        );
    });
  }
}
