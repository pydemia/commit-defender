import * as vscode from "vscode";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { centralConnectionInput, type LocalScope } from "@gcr/client-contract";
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
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px}td,th{padding:8px;text-align:left;vertical-align:top;border-bottom:1px solid var(--vscode-panel-border);overflow-wrap:anywhere}table{width:100%;table-layout:fixed}th{width:12em}p{max-width:70ch}code{word-break:break-all}</style></head><body><h1>Central review connection</h1><p>Online reviews refresh expired knowledge. Offline reviews require an unexpired signed lease and active connection. Model availability is checked separately when a review starts.</p><table>${rows.map(([label, item]) => `<tr><th>${esc(label)}</th><td>${esc(item ?? "Unavailable")}</td></tr>`).join("")}</table><h2>Signed knowledge bundles</h2><p>Read-only snapshot metadata. Local Memory and Skills remain editable in their own view.</p><table>${bundles || "<tr><td>No verified snapshot is available.</td></tr>"}</table></body></html>`;
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
export async function manageCentralConnection(
  context: vscode.ExtensionContext,
  scope: Extract<LocalScope, { kind: "repository" }>,
  actions: {
    assertCurrent(): void;
    invalidate(): Promise<void>;
    refresh(): Promise<void>;
  },
  ports: CentralPorts = {},
): Promise<void> {
  const key = selectionKey(scope);
  const withManager = <T>(work: (manager: CentralConnections) => Promise<T>) =>
    withCentralConnection(scope, work, ports);
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
    actions.assertCurrent();
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
      const confirmed = await vscode.window.showInformationMessage(
        `Connect this worktree to ${config.serverUrl} (server ${config.serverId}, tenant ${config.tenantId}, repository ${config.repositoryId})?`,
        {
          modal: true,
          detail: `Verify these public signing-key fingerprints against your administrator's configuration. ${pins}`,
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
              ),
            ),
        );
        await select({
          version: 1,
          mode: "centralized",
          connectionId: connected.id,
          freshness: "online",
        });
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
          : "Connection disconnected. Select standalone review or reconnect before reviewing.",
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
    });
    context.subscriptions.push(panel);
  } catch (error) {
    void vscode.window.showErrorMessage(standaloneError(error).message);
  } finally {
    activeViews.delete(key);
  }
}
