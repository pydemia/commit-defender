import type { LocalScope } from "@gcr/client-contract";
import { KnowledgeSyncLoop, type KnowledgeSyncState } from "@gcr/client-core";
import {
  centralSelection,
  selectedCentralSources,
  selectionKey,
  withCentralConnection,
  type CentralPorts,
  type CentralSelection,
} from "./centralConnection.js";
import { StandaloneReviewError } from "./standaloneReviewProtocol.js";

type Target = {
  scope: LocalScope;
  selection?: CentralSelection;
  repositoryRoot?: string;
};
/** Selections come from extension globalState for trusted workspace roots only.
 * Repository configuration and remote URLs never provide credential targets. */
export class CentralSynchronization {
  private loops = new Map<string, KnowledgeSyncLoop>();
  private retiring = new Set<Promise<void>>();
  constructor(
    private readonly options: {
      ports?: CentralPorts;
      onState?(key: string, state: KnowledgeSyncState): void;
      synchronize?(
        scope: LocalScope,
        id: string,
        signal: AbortSignal,
      ): Promise<unknown>;
    } = {},
  ) {}
  reconcile(targets: Target[]) {
    const wanted = new Map<
      string,
      { scope: LocalScope; id: string; repositoryRoot?: string }
    >();
    for (const { scope, selection, repositoryRoot } of targets) {
      if (!selection) continue;
      const selected = centralSelection(selection);
      if (selected.mode !== "centralized" || selected.freshness !== "online")
        continue;
      for (const source of selectedCentralSources(selected))
        wanted.set(`${selectionKey(scope)}:${source.connectionId}`, {
          scope,
          id: source.connectionId,
          ...(repositoryRoot ? { repositoryRoot } : {}),
        });
    }
    for (const [key, loop] of this.loops) {
      if (wanted.has(key)) continue;
      this.retire(loop);
      this.loops.delete(key);
    }
    for (const [key, { scope, id, repositoryRoot }] of wanted) {
      if (this.loops.has(key)) continue;
      const loop = new KnowledgeSyncLoop({
        synchronize: async (signal) => {
          if (this.options.synchronize)
            return this.options.synchronize(scope, id, signal);
          return withCentralConnection(
            scope,
            async (manager) => {
              if (signal.aborted) return;
              const status = await manager.status(id);
              if (status.clientId !== "commit-defender")
                throw new StandaloneReviewError("authentication-required");
              if (!signal.aborted) return manager.synchronize(id, signal);
            },
            {
              ...this.options.ports,
              ...(repositoryRoot ? { repositoryRoot } : {}),
            },
          );
        },
        onState: (state) => this.options.onState?.(key, state),
      });
      this.loops.set(key, loop);
      loop.start();
    }
  }
  wake() {
    for (const loop of this.loops.values()) loop.wake();
  }
  stop() {
    for (const loop of this.loops.values()) this.retire(loop);
    this.loops.clear();
  }
  async settled() {
    await Promise.all([
      ...this.retiring,
      ...[...this.loops.values()].map((loop) => loop.settled()),
    ]);
  }
  private retire(loop: KnowledgeSyncLoop) {
    loop.stop();
    const done = loop.settled();
    this.retiring.add(done);
    void done.finally(() => this.retiring.delete(done));
  }
}
