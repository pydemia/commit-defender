import { CentralConnectionSetupError } from "@gcr/client-core";
import * as vscode from "vscode";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  centralConnectionInput,
  offlineBehavior,
  type OfflineBehavior,
  type LocalScope,
} from "@gcr/client-contract";
import {
  normalizeCentralServerUrl,
  discoverCentralConnections,
  CentralDiscoveryTlsError,
  validateCentralCa,
  validateCentralApiKey,
  type CentralConnections,
  localRepositoryRemotes,
  canonicalRepositoryRemote,
} from "@gcr/client-core";
import {
  readSelection,
  selectedCentralSources,
  centralSelection,
  type CentralSource,
  selectionKey,
  withCentralConnection,
  type CentralPorts,
  type CentralSelection,
} from "./centralConnection.js";
import {
  standaloneError,
  StandaloneReviewError,
} from "./standaloneReviewProtocol.js";
import {
  showCentralKnowledge,
  centralSourcesKnowledgeHtml,
  showAuthorizedCentralText,
} from "./centralKnowledgeView.js";
import { browseCentralHistory } from "./centralHistoryView.js";
import { openConnectionGuide } from "./connectionGuide.js";

const esc = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** Only non-secret connection metadata is rendered. No scripts, links or export command. */
export function centralStatusHtml(value: unknown): string {
  const v = value as Record<string, unknown> & {
    audience?: Record<string, unknown>;
    cache?: Record<string, unknown> & { components?: Record<string, unknown> };
  };
  const cache = v.cache ?? {},
    audience = v.audience ?? {};
  const rows = [
    ["Review mode", v.requestedMode],
    ["Offline behavior", v.offlineBehavior ?? "pause"],
    [
      "Knowledge source",
      v.freshness === "offline"
        ? "Signed offline cache"
        : "Online (startup, periodic and review freshness sync)",
    ],
    ["Local profile", v.profileId],
    ["Server", v.serverUrl],
    ["Server ID", audience.serverId],
    ["Tenant", audience.tenantId],
    ["Repository", audience.repositoryId],
    ["User", audience.userId],
    ["Connection", v.status],
    [
      "Git remote mapping",
      cache.reason === "repository-mismatch"
        ? "Git remotes changed; reconnect"
        : v.repositoryBinding
          ? "Verified against central repository identity"
          : "Manual connection; remote mapping not recorded",
    ],
    ["API key expires", v.expiresAt === null ? "No expiration" : v.expiresAt],
    ["Verified cache", cache.status],
    ["Cache problem", cache.reason ?? "None"],
    [
      "Last successful sync",
      typeof cache.lastSynchronizedAt === "number"
        ? new Date(cache.lastSynchronizedAt).toISOString()
        : "Unavailable",
    ],
    ["Snapshot", cache.snapshotId ?? "Unavailable"],
    ["Online refresh due", cache.refreshAfter ?? "Unavailable"],
    ["Offline lease expires", cache.offlineValidUntil ?? "Unavailable"],
  ];
  const bundles = Object.entries(cache.components ?? {})
    .map(([name, item]) => {
      const bundle = item as Record<string, unknown>;
      return `<tr><th>${esc(name)}</th><td>Release ${esc(bundle.releaseSequence)} · ${esc(bundle.bundleId)}<br><code>${esc(bundle.contentHash)}</code></td></tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px}td,th{padding:8px;text-align:left;vertical-align:top;border-bottom:1px solid var(--vscode-panel-border);overflow-wrap:anywhere}table{width:100%;table-layout:fixed}th{width:12em}p{max-width:70ch}code{word-break:break-all}</style></head><body><h1>Central review connection</h1><p>This connection reads PR history, Skills, prompts and published guidance from GCR. Your selected local provider, model and reasoning stay unchanged. Local code and results are not uploaded to GCR; approved source and context go to the model provider you select.</p><p>Online reviews require fresh signed knowledge; the current server uses a five-minute manifest lifetime. An already running review keeps its pinned version and can stop at expiry. Offline reviews require a valid signed lease and active authority. Model failures are checked separately from connection and cache failures.</p><table>${rows.map(([label, item]) => `<tr><th>${esc(label)}</th><td>${esc(item ?? "Unavailable")}</td></tr>`).join("")}</table><h2>Signed knowledge bundles</h2><p>Read-only snapshot metadata. To inspect originals, replies and versions, choose Browse PR review history. Use View downloaded review knowledge for Skills and guidance. Local Memory and Skills remain separately editable and are not uploaded.</p><table>${bundles || "<tr><td>No verified snapshot is available.</td></tr>"}</table></body></html>`;
}
async function askApiKey(serverUrl: string) {
  return vscode.window.showInputBox({
    title: "GCR API key",
    prompt: `API key for ${serverUrl}. Stored in the OS credential store.`,
    password: true,
    ignoreFocusOut: true,
    validateInput(value) {
      try {
        validateCentralApiKey(value.trim());
        return undefined;
      } catch {
        return "Enter a valid GCR API key (not JSON).";
      }
    },
  });
}
async function readPublicFile(file: string, limit: number) {
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  try {
    if (!(await handle.stat()).isFile())
      throw new StandaloneReviewError("invalid-binding");
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) throw new StandaloneReviewError("invalid-binding");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
async function readConfig(file: string) {
  return centralConnectionInput(JSON.parse(await readPublicFile(file, 100000)));
}

const activeViews = new Set<string>();
let knowledgePanel: vscode.WebviewPanel | undefined;
export async function manageCentralConnection(
  context: vscode.ExtensionContext,
  scope: Extract<LocalScope, { kind: "repository" }>,
  actions: {
    repositoryRoot?: string;
    assertCurrent(): void;
    invalidate(): Promise<void>;
    refresh(): Promise<void>;
  },
  ports: CentralPorts = {},
): Promise<void> {
  const key = selectionKey(scope);
  const withManager = <T>(work: (manager: CentralConnections) => Promise<T>) =>
    withCentralConnection(scope, work, {
      ...ports,
      ...(actions.repositoryRoot
        ? { repositoryRoot: actions.repositoryRoot }
        : {}),
    });
  if (activeViews.has(key)) return;
  activeViews.add(key);
  let selection: CentralSelection | undefined;
  const select = async (value: CentralSelection) => {
    actions.assertCurrent();
    await actions.invalidate();
    actions.assertCurrent();
    await context.globalState.update(key, value);
    selection = value;
    await actions.refresh();
  };
  const progress = <T>(
    title: string,
    work: (signal: AbortSignal) => Promise<T>,
  ) =>
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
      },
      async (_, token) => {
        const controller = new AbortController();
        const listener = token.onCancellationRequested(() =>
          controller.abort(),
        );
        if (token.isCancellationRequested) controller.abort();
        try {
          actions.assertCurrent();
          return await work(controller.signal);
        } finally {
          listener.dispose();
        }
      },
    );
  try {
    actions.assertCurrent();
    selection = readSelection(context.globalState, scope);
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: "GCR connection guide",
          action: "guide",
          description: "API key, account/model, connection and first review",
        },
        {
          label: "Connect with API key…",
          action: "connect",
          description:
            "Enter the server URL and API key; read all authorized review sources",
        },
        {
          label: "Import connection JSON…",
          action: "import-json",
          description:
            "Compatibility with older GCR servers; API key entered separately",
        },
        {
          label: "Select saved connection…",
          action: "select",
          description:
            "Use a saved server connection in this profile and worktree",
        },
        {
          label: "Connection status",
          action: "status",
          description: "Server, user, repository, bundle hashes and expiry",
        },
        {
          label: "Synchronize knowledge",
          action: "sync",
          description: "Download and verify a complete signed snapshot",
        },
        {
          label: "View downloaded review knowledge",
          action: "knowledge",
          description:
            "Read central prompts, Skills and guidance; keep your selected local provider",
        },
        {
          label: "Reference sources…",
          action: "sources",
          description:
            "Optional: inspect available material and limit reference sources",
        },
        {
          label: "Browse PR review history",
          action: "history",
          description:
            "Read originals, replies and versions without memory approval; no model call",
        },
        {
          label: "Use signed offline knowledge",
          action: "offline",
          description:
            "Explicitly use the selected cache while its lease is valid",
        },
        {
          label: "Use standalone review",
          action: "standalone",
          description: "Use local knowledge; retain the central connection",
        },
        {
          label: "Offline and fallback behavior…",
          action: "fallback",
          description:
            "Choose cache, local fallback or pause for this worktree",
        },
        {
          label: "Disconnect selected connection",
          action: "disconnect",
          description: "Remove its local key and disable its central cache",
        },
      ],
      {
        title: `Review connection · ${scope.profileId} · ${selection?.mode ?? "User Settings default"}`,
      },
    );
    if (!choice) return;
    if (choice.action === "guide") {
      await openConnectionGuide(context);
      return;
    }
    actions.assertCurrent();
    knowledgePanel?.dispose();
    knowledgePanel = undefined;
    if (choice.action === "standalone") {
      if (selection?.mode === "centralized" && selection.sources)
        await context.globalState.update(`${key}:saved`, selection);
      await select({ version: 1, mode: "standalone" });
      return;
    }
    if (choice.action === "connect" || choice.action === "import-json") {
      let config: ReturnType<typeof centralConnectionInput>;
      let secret: string | undefined;
      let discovered:
        Awaited<ReturnType<typeof discoverCentralConnections>> | undefined;
      let matchingRepositoryId: string | undefined;
      const behavior: OfflineBehavior =
        selection?.mode === "centralized"
          ? (selection.offlineBehavior ?? "pause")
          : "cache-then-standalone";
      try {
        if (choice.action === "import-json") {
          const files = await vscode.window.showOpenDialog({
            title: "Choose trusted central connection configuration",
            canSelectMany: false,
            filters: { JSON: ["json"] },
          });
          if (!files?.[0] || files[0].scheme !== "file") return;
          actions.assertCurrent();
          config = await readConfig(files[0].fsPath);
          config.serverUrl = normalizeCentralServerUrl(config.serverUrl);
        } else {
          const url = await vscode.window.showInputBox({
            title: "GCR server URL",
            prompt:
              "Use the HTTPS server URL shown in GCR Profile → Clients. No JSON is required.",
            ignoreFocusOut: true,
            validateInput(value) {
              try {
                normalizeCentralServerUrl(value.trim());
                return undefined;
              } catch {
                return "Enter an HTTPS server URL without credentials, query or fragment.";
              }
            },
          });
          if (!url) return;
          const serverUrl = normalizeCentralServerUrl(url.trim());
          secret = await askApiKey(serverUrl);
          if (!secret) return;
          const discover = (ca?: string) =>
            progress("Reading GCR repositories", (signal) =>
              discoverCentralConnections(
                serverUrl,
                secret!.trim(),
                "commit-defender",
                { signal, ...(ca ? { ca } : {}) },
              ),
            );
          let metadata;
          try {
            metadata = await discover();
          } catch (cause) {
            if (!(cause instanceof CentralDiscoveryTlsError)) throw cause;
            const selected = await vscode.window.showInformationMessage(
              "Commit Defender: GCR uses a CA certificate that is not trusted on this machine.",
              {
                modal: true,
                detail:
                  "Download the public CA certificate from GCR Profile → Clients, or obtain it from your administrator. TLS verification stays enabled.",
              },
              "Choose CA certificate…",
            );
            if (!selected) return;
            const files = await vscode.window.showOpenDialog({
              title: "Choose public GCR CA certificate",
              canSelectMany: false,
              filters: { Certificates: ["pem", "crt"] },
            });
            if (!files?.[0] || files[0].scheme !== "file") return;
            const ca = validateCentralCa(
              await readPublicFile(files[0].fsPath, 65536),
            );
            actions.assertCurrent();
            metadata = await discover(ca);
          }
          actions.assertCurrent();
          if (!metadata.repositories.length) {
            void vscode.window.showInformationMessage(
              "Commit Defender: This API key has no currently accessible repositories. Check GCR permissions and key scope.",
            );
            return;
          }
          discovered = metadata;
          const remotes = actions.repositoryRoot
            ? localRepositoryRemotes(actions.repositoryRoot)
            : [];
          const matches = metadata.repositories.filter((repo) =>
            remotes.some(
              (remote) =>
                remote.canonical ===
                canonicalRepositoryRemote(
                  `${repo.webBaseUrl.replace(/\/$/, "")}/${repo.owner}/${repo.name}`,
                ),
            ),
          );
          matchingRepositoryId =
            matches.length === 1 ? matches[0].repositoryId : undefined;
          const anchor =
            matches.length === 1 ? matches[0] : metadata.repositories[0];
          config = centralConnectionInput({
            serverUrl: metadata.serverUrl,
            serverId: metadata.serverId,
            tenantId: metadata.tenantId,
            repositoryId: anchor.repositoryId,
            trustedKeys: metadata.trustedKeys,
            ca: metadata.ca,
          });
        }
        const pins = config.trustedKeys
          .map(
            (k) =>
              `${k.id}: ${createHash("sha256").update(k.pem).digest("hex")}`,
          )
          .join(" · ");
        const confirmed = await vscode.window.showInformationMessage(
          `Connect to ${config.serverUrl} and read authorized review knowledge?`,
          {
            modal: true,
            detail: `${discovered ? `${discovered.repositories.length} authorized review sources. No repository selection is required. Other repositories provide reference material; only a source matching this worktree can supply its policy. ` : "Legacy single-source connection. "}Verify these public signing-key fingerprints against your administrator's configuration. ${pins} On central failure: ${behavior}. If this policy allows local fallback, reviews use only local/built-in knowledge and the same approved model account. You can change this in Offline and fallback behavior.`,
          },
          "Connect",
        );
        if (confirmed !== "Connect") return;
        if (!secret) secret = await askApiKey(config.serverUrl);
        if (!secret) return;
        if (discovered) {
          const metadata = discovered;
          const sources: CentralSource[] = [];
          await progress("Connecting central review sources", (signal) =>
            withManager(async (manager) => {
              const existing = new Set(
                (await manager.list())
                  .filter((c) => c.status === "connected")
                  .map((c) => c.id),
              );
              const created: string[] = [];
              try {
                for (const repo of metadata.repositories) {
                  actions.assertCurrent();
                  const connected = await manager.connect(
                    { ...config, repositoryId: repo.repositoryId },
                    secret!.trim(),
                    "commit-defender",
                    signal,
                    {
                      offlineBehavior: behavior,
                      referenceOnly: repo.repositoryId !== matchingRepositoryId,
                      reuseExisting: true,
                    },
                  );
                  if (!existing.has(connected.id)) created.push(connected.id);
                  sources.push({
                    connectionId: connected.id,
                    repositoryId: repo.repositoryId,
                    label: `${repo.owner}/${repo.name}`,
                    referenceOnly: connected.referenceOnly,
                  });
                }
              } catch (error) {
                for (const id of created) await manager.disconnect(id);
                throw error;
              }
            }),
          );
          const anchor = sources.find((s) => !s.referenceOnly) ?? sources[0];
          const group = {
            version: 1 as const,
            mode: "centralized" as const,
            connectionId: anchor.connectionId,
            sources,
            freshness: "online" as const,
            offlineBehavior: behavior,
          };
          actions.assertCurrent();
          await context.globalState.update(`${key}:catalog`, group);
          await select(group);
          void vscode.window.showInformationMessage(
            `Commit Defender: Connected. ${sources.length} review sources are available. Relevant material is selected locally; your model settings stay unchanged.`,
          );
        } else {
          const connected = await progress(
            "Connecting and waiting for central review knowledge",
            (signal) =>
              withManager((manager) =>
                manager.connect(
                  config,
                  secret!.trim(),
                  "commit-defender",
                  signal,
                  { offlineBehavior: behavior },
                ),
              ),
          );
          await select({
            version: 1,
            mode: "centralized",
            connectionId: connected.id,
            freshness: "online",
            offlineBehavior: behavior,
          });
        }
      } catch (cause) {
        // Identity was authenticated and the first publication failed. Keep the
        // confirmed selection for local fallback; the failed key was removed.
        if (
          cause instanceof CentralConnectionSetupError &&
          (behavior === "cache-then-standalone" || behavior === "standalone")
        ) {
          await select({
            version: 1,
            mode: "centralized",
            connectionId: cause.connectionId,
            freshness: "online",
            offlineBehavior: behavior,
          });
          void vscode.window.showInformationMessage(
            "Central knowledge could not be activated. The confirmed local fallback policy is available; reconnect to use central knowledge.",
          );
        } else throw cause;
      } finally {
        secret = undefined;
      }
      return;
    }
    if (choice.action === "select") {
      const saved =
        context.globalState.get(`${key}:saved`) ??
        context.globalState.get(`${key}:catalog`);
      if (saved) {
        const group = centralSelection(saved);
        if (group.mode !== "centralized")
          throw new StandaloneReviewError("central-connection-required");
        await withManager(async (manager) => {
          for (const source of selectedCentralSources(group)) {
            const status = await manager.status(source.connectionId);
            if (status.status !== "connected")
              throw new StandaloneReviewError("authentication-required");
          }
        });
        await select({ ...group, freshness: "online" });
        return;
      }
      const connections = await withManager((manager) => manager.list());
      const entries = connections.filter(
        (c) => c.status === "connected" && c.clientId === "commit-defender",
      );
      const picked = await vscode.window.showQuickPick(
        entries.map((c) => ({
          label: c.serverUrl,
          description: `Repository ${c.audience.repositoryId} · User ${c.audience.userId}`,
          detail: `Tenant ${c.audience.tenantId} · API key expires ${c.expiresAt === null ? "No expiration" : c.expiresAt}`,
          id: c.id,
        })),
        { title: "Select this worktree's central repository" },
      );
      if (picked)
        await select({
          version: 1,
          mode: "centralized",
          connectionId: picked.id,
          freshness: "online",
          offlineBehavior:
            selection?.mode === "centralized" &&
            selection.connectionId === picked.id
              ? (selection.offlineBehavior ?? "pause")
              : (connections.find((c) => c.id === picked.id)?.offlineBehavior ??
                "pause"),
        });
      else if (!entries.length)
        void vscode.window.showInformationMessage(
          "No active Commit Defender connection exists in this profile and worktree.",
        );
      return;
    }
    if (selection?.mode !== "centralized")
      throw new StandaloneReviewError("central-connection-required");
    let id = selection.connectionId;
    const sources = selectedCentralSources(selection);
    if (choice.action === "sources") {
      const catalog = centralSelection(
        context.globalState.get(`${key}:catalog`) ?? selection,
      );
      if (catalog.mode !== "centralized")
        throw new StandaloneReviewError("central-connection-required");
      const available = selectedCentralSources(catalog);
      const entries = await withManager(async (manager) => {
        const result = [];
        for (const source of available) {
          const status = await manager.status(source.connectionId);
          const access = await manager.review(
            source.connectionId,
            selection!.mode === "centralized" ? selection!.freshness : "online",
          );
          const snapshot = await access.cache.read(access.freshness);
          await access.assertConnection();
          result.push({
            label: source.label,
            source,
            picked: sources.some((s) => s.connectionId === source.connectionId),
            description: source.referenceOnly
              ? "Optional reference material"
              : "Current repository policy (always included)",
            detail: `${snapshot.bundles.policy.component === "policy" ? snapshot.bundles.policy.skills.skills.length : 0} Skills · ${["collective", "personal"].reduce((n, part) => n + ("memories" in snapshot.bundles[part as "collective" | "personal"] ? (snapshot.bundles[part as "collective" | "personal"] as any).memories.length : 0), 0)} published guidance items · ${status.cache.status}`,
          });
        }
        return result;
      });
      const picked = await vscode.window.showQuickPick(entries, {
        title:
          "Reference sources · all authorized sources are included by default",
        canPickMany: true,
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!picked) return;
      const kept = [
        ...new Map(
          [
            ...picked.map((entry) => entry.source),
            ...available.filter((s) => !s.referenceOnly),
          ].map((s) => [s.connectionId, s]),
        ).values(),
      ];
      if (!kept.length) {
        void vscode.window.showInformationMessage(
          "Commit Defender: No reference sources selected. Use standalone review to review without central material.",
        );
        return;
      }
      const anchor = kept.find((s) => !s.referenceOnly) ?? kept[0];
      await select({
        ...selection,
        connectionId: anchor.connectionId,
        sources: kept,
      });
      return;
    }
    if (choice.action === "sync") {
      await progress("Synchronizing authorized review sources", (signal) =>
        withManager(async (manager) => {
          for (const source of sources)
            await manager.synchronize(source.connectionId, signal);
        }),
      );
      await actions.refresh();
      return;
    }
    if (choice.action === "history" && sources.length > 1) {
      const picked = await vscode.window.showQuickPick(
        sources.map((source) => ({
          label: source.label,
          source,
          description: "Browse saved PR comments, replies and versions",
        })),
        {
          title:
            "Browse history by source · this does not change the connection",
        },
      );
      if (!picked) return;
      id = picked.source.connectionId;
    }
    if (choice.action === "history") {
      const selected = JSON.stringify(selection),
        freshness = selection.freshness;
      const validate = async () => {
        actions.assertCurrent();
        if (
          JSON.stringify(readSelection(context.globalState, scope)) !== selected
        )
          throw new StandaloneReviewError("central-connection-required");
        await withManager(async (manager) => {
          const status = await manager.status(id);
          if (status.clientId !== "commit-defender")
            throw new StandaloneReviewError("central-connection-required");
          const access = await manager.review(id, freshness);
          await access.cache.read(freshness);
          await access.assertConnection();
        });
      };
      await browseCentralHistory(
        context,
        async (request) => {
          await validate();
          const result = await withManager((manager) =>
            manager.readHistory(id, request, freshness),
          );
          await validate();
          return result;
        },
        validate,
      );
      return;
    }
    if (choice.action === "knowledge") {
      if (sources.length > 1) {
        const selected = JSON.stringify(selection),
          freshness = selection.freshness;
        const snapshots = await progress(
          "Reading downloaded review sources",
          (signal) =>
            withManager(async (manager) => {
              const result = [];
              for (const source of sources) {
                const access = await manager.review(
                  source.connectionId,
                  freshness,
                  signal,
                );
                const snapshot = await access.cache.read(freshness);
                await access.assertConnection();
                result.push({
                  label: source.label,
                  referenceOnly: source.referenceOnly,
                  snapshot,
                  connectionId: source.connectionId,
                });
              }
              return result;
            }),
        );
        const validate = async () => {
          actions.assertCurrent();
          if (
            JSON.stringify(readSelection(context.globalState, scope)) !==
            selected
          )
            throw new StandaloneReviewError("central-connection-required");
          await withManager(async (manager) => {
            for (const entry of snapshots) {
              const access = await manager.review(
                entry.connectionId,
                "offline",
              );
              const current = await access.cache.read("offline");
              await access.assertConnection();
              if (
                current.manifest.manifestHash !==
                entry.snapshot.manifest.manifestHash
              )
                throw new StandaloneReviewError("central-snapshot-changed");
            }
          });
        };
        await validate();
        knowledgePanel = showAuthorizedCentralText(
          context,
          "Downloaded review knowledge",
          centralSourcesKnowledgeHtml(snapshots),
          Math.min(
            ...snapshots.map((s) =>
              Date.parse(s.snapshot.manifest.payload.offlineValidUntil),
            ),
          ),
          validate,
        );
        return;
      }
      const selected = JSON.stringify(selection);
      const assertSelection = () => {
        actions.assertCurrent();
        if (
          JSON.stringify(readSelection(context.globalState, scope)) !== selected
        )
          throw new StandaloneReviewError("central-connection-required");
      };
      const freshness = selection.freshness;
      const snapshot = await progress(
        "Reading downloaded review knowledge",
        (signal) =>
          withManager(async (manager) => {
            const status = await manager.status(id);
            if (status.clientId !== "commit-defender")
              throw new StandaloneReviewError("authentication-required");
            const ready = await manager.review(id, freshness, signal);
            const value = await ready.cache.read(freshness);
            await ready.assertConnection();
            assertSelection();
            return value;
          }),
      );
      assertSelection();
      knowledgePanel = showCentralKnowledge(context, snapshot, async () => {
        assertSelection();
        await withManager(async (manager) => {
          const ready = await manager.review(id, "offline");
          const current = await ready.cache.read("offline");
          await ready.assertConnection();
          if (current.manifest.manifestHash !== snapshot.manifest.manifestHash)
            throw new StandaloneReviewError("central-connection-required");
        });
        assertSelection();
      });
      return;
    }
    if (choice.action === "fallback") {
      const picked = await vscode.window.showQuickPick(
        [
          {
            label: "Cache, then standalone",
            behavior: "cache-then-standalone",
            description:
              "Use valid signed cache; otherwise review local/built-in knowledge with the same model account",
          },
          {
            label: "Cache only",
            behavior: "cache-only",
            description: "Pause if authorized signed cache is unavailable",
          },
          {
            label: "Standalone on failure",
            behavior: "standalone",
            description:
              "Use only local/built-in knowledge when central access fails",
          },
          {
            label: "Pause",
            behavior: "pause",
            description:
              "Require the requested central knowledge source; do not fall back",
          },
        ],
        { title: "Confirm this worktree's offline and fallback behavior" },
      );
      if (picked)
        await select({
          ...selection,
          offlineBehavior: offlineBehavior(picked.behavior),
        });
      return;
    }
    if (choice.action === "offline") {
      await withManager(async (manager) => {
        for (const source of sources) {
          const ready = await manager.review(source.connectionId, "offline");
          await ready.cache.read("offline");
          await ready.assertConnection();
        }
      });
      await select({ ...selection, freshness: "offline" });
      return;
    }
    if (choice.action === "disconnect") {
      await actions.invalidate();
      actions.assertCurrent();
      const results = await withManager(async (manager) => {
        const result = [];
        for (const source of sources)
          result.push(await manager.disconnect(source.connectionId));
        return result;
      });
      const result = {
        credentialCleanupPending: results.some(
          (r) => r.credentialCleanupPending,
        ),
        cacheCleanupPending: results.some((r) => r.cacheCleanupPending),
      };
      // Keep the selected mode to report disconnection; never silently authorize standalone execution.
      await actions.refresh();
      void vscode.window.showInformationMessage(
        result.credentialCleanupPending || result.cacheCleanupPending
          ? "Connection disabled. Some local cleanup remains pending; retry disconnect."
          : `Connection disconnected. Central knowledge is unavailable; offline behavior is ${selection.offlineBehavior ?? "pause"}. Reconnect to restore central reviews.`,
      );
      return;
    }
    if (choice.action === "sync")
      await progress("Synchronizing central knowledge", (signal) =>
        withManager((manager) => manager.synchronize(id, signal)),
      );
    actions.assertCurrent();
    const status = await withManager((manager) => manager.status(id));
    actions.assertCurrent();
    const panel = vscode.window.createWebviewPanel(
      "commitDefender.centralConnection",
      "Central review connection",
      vscode.ViewColumn.Active,
      { enableScripts: false, localResourceRoots: [] },
    );
    panel.webview.html = centralStatusHtml({
      requestedMode: selection.mode,
      freshness: selection.freshness,
      profileId: scope.profileId,
      ...status,
      offlineBehavior: selection.offlineBehavior ?? "pause",
    }).replace(
      "</body>",
      `<h2>Review sources (${sources.length})</h2><ul>${sources.map((source) => `<li>${esc(source.label)} · ${source.referenceOnly ? "Reference material" : "Current repository policy"}</li>`).join("")}</ul><p>Repository names identify material sources. They do not change which local code is reviewed.</p></body>`,
    );
    context.subscriptions.push(panel);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Commit Defender: Central review connection — ${standaloneError(error).message}`,
    );
  } finally {
    activeViews.delete(key);
  }
}
