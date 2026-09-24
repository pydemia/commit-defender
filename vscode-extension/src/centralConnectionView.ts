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
  validateCentralApiKey,
  type CentralConnections,
} from "@gcr/client-core";
import {
  readSelection,
  selectionKey,
  withCentralConnection,
  type CentralPorts,
  type CentralSelection,
} from "./centralConnection.js";
import {
  standaloneError,
  StandaloneReviewError,
} from "./standaloneReviewProtocol.js";
import { showCentralKnowledge } from "./centralKnowledgeView.js";
import { browseCentralHistory } from './centralHistoryView.js';
import { openConnectionGuide } from './connectionGuide.js';

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
    ["API key expires", v.expiresAt],
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
async function readConfig(file: string) {
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  try {
    if (!(await handle.stat()).isFile())
      throw new StandaloneReviewError("invalid-binding");
    const buffer = Buffer.alloc(100_001);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 100_000) throw new StandaloneReviewError("invalid-binding");
    return centralConnectionInput(
      JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")),
    );
  } finally {
    await handle.close();
  }
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
          description: "Reader key, account/model, connection and first review",
        },
        {
          label: "Connect with API key…",
          action: "connect",
          description: "Choose trusted server configuration and enter a key",
        },
        {
          label: "Select connected repository…",
          action: "select",
          description:
            "Use an existing connection in this profile and worktree",
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
        { label: "Browse PR review history", action: "history", description: "Read originals, replies and versions without memory approval; no model call" },
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
      await select({ version: 1, mode: "standalone" });
      return;
    }
    if (choice.action === "connect") {
      const files = await vscode.window.showOpenDialog({
        title: "Choose trusted central connection configuration",
        canSelectMany: false,
        filters: { JSON: ["json"] },
      });
      if (!files?.[0] || files[0].scheme !== "file") return;
      actions.assertCurrent();
      const config = await readConfig(files[0].fsPath);
      config.serverUrl = normalizeCentralServerUrl(config.serverUrl);
      const pins = config.trustedKeys
        .map(
          (k) => `${k.id}: ${createHash("sha256").update(k.pem).digest("hex")}`,
        )
        .join(" · ");
      const behavior: OfflineBehavior =
        selection?.mode === "centralized"
          ? (selection.offlineBehavior ?? "pause")
          : "cache-then-standalone";
      const confirmed = await vscode.window.showInformationMessage(
        `Connect this worktree to ${config.serverUrl} (server ${config.serverId}, tenant ${config.tenantId}, repository ${config.repositoryId})?`,
        {
          modal: true,
          detail: `Verify these public signing-key fingerprints against your administrator's configuration. ${pins} On central failure: ${behavior}. If this policy allows local fallback, reviews use only local/built-in knowledge and the same approved model account. You can change this in Offline and fallback behavior.`,
        },
        "Connect",
      );
      if (confirmed !== "Connect") return;
      let secret = await vscode.window.showInputBox({
        title: "Central API key",
        prompt: `Key for ${config.serverUrl}. Stored in the OS credential store.`,
        password: true,
        ignoreFocusOut: true,
        validateInput(value) {
          try {
            validateCentralApiKey(value.trim());
            return undefined;
          } catch {
            return "Enter a valid GCR API key.";
          }
        },
      });
      if (!secret) return;
      try {
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
      const connections = await withManager((manager) => manager.list());
      const entries = connections.filter(
        (c) => c.status === "connected" && c.clientId === "commit-defender",
      );
      const picked = await vscode.window.showQuickPick(
        entries.map((c) => ({
          label: c.serverUrl,
          description: `Repository ${c.audience.repositoryId} · User ${c.audience.userId}`,
          detail: `Tenant ${c.audience.tenantId} · API key expires ${c.expiresAt}`,
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
    const id = selection.connectionId;
    if (choice.action === 'history') {
      const selected = JSON.stringify(selection), freshness = selection.freshness;
      const validate = async () => {
        actions.assertCurrent();
        if (JSON.stringify(readSelection(context.globalState, scope)) !== selected) throw new StandaloneReviewError('central-connection-required');
        await withManager(async manager => {
          const status = await manager.status(id);
          if (status.clientId !== 'commit-defender') throw new StandaloneReviewError('central-connection-required');
          const access = await manager.review(id, freshness);
          await access.cache.read(freshness); await access.assertConnection();
        });
      };
      await browseCentralHistory(context, async request => {
        await validate();
        const result = await withManager(manager => manager.readHistory(id, request, freshness));
        await validate(); return result;
      }, validate);
      return;
    }
    if (choice.action === "knowledge") {
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
        const ready = await manager.review(id, "offline");
        await ready.cache.read("offline");
      });
      await select({ ...selection, freshness: "offline" });
      return;
    }
    if (choice.action === "disconnect") {
      await actions.invalidate();
      actions.assertCurrent();
      const result = await withManager((manager) => manager.disconnect(id));
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
    });
    context.subscriptions.push(panel);
  } catch (error) {
    void vscode.window.showErrorMessage(`Commit Defender: Central review connection — ${standaloneError(error).message}`);
  } finally {
    activeViews.delete(key);
  }
}
