import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { projectCommitDefender, type LocalScope } from "@gcr/client-contract";
import { RemoteReviewClient } from "@gcr/client-core";
import {
  withCentralConnection,
  type CentralPorts,
} from "./centralConnection.js";
import {
  prepareRemoteModelReview,
  RemoteModelReviewError,
  type RemoteProposal,
} from "./remoteModelReview.js";
import type { ReviewRequest } from "./reviewBackend.js";
import type { StandaloneReviewSettings } from "./standaloneReviewProtocol.js";

const esc = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function remoteApprovalHtml(proposal: RemoteProposal, nonce: string) {
  const p = proposal.payload;
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;max-width:1000px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--vscode-textCodeBlock-background);padding:16px}button{padding:10px 18px;margin:12px 12px 12px 0;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;cursor:pointer}dt{font-weight:600;margin-top:10px}dd{margin:4px 0;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px;border-bottom:1px solid var(--vscode-panel-border)}</style></head><body>
<h1>Approve central model review</h1><p>Review the exact upload below. Approval sends these source and knowledge bytes to the selected server and authorizes this account to run the review.</p>
<dl><dt>Server</dt><dd>${esc(proposal.serverUrl)}</dd><dt>Repository / user</dt><dd>${esc(p.audience.repositoryId)} / ${esc(p.audience.userId)}</dd>
<dt>Account / model / effort</dt><dd>${esc(p.model.accountId)} / ${esc(p.model.name)} / ${esc(p.model.reasoningEffort)}</dd>
<dt>Knowledge mode</dt><dd>${esc(p.client.mode)}</dd><dt>Execution budget</dt><dd>${p.budget.modelCalls} model calls · ${p.budget.durationMs / 1000} seconds · ${p.budget.toolCalls} tool calls · ${p.budget.sourceBytes} source-tool bytes. Output token cap is unsupported.</dd>
<dt>Server retention</dt><dd>Source ${p.retention.sourceSeconds} seconds; result ${p.retention.resultSeconds} seconds from admission.</dd>
<dt>Upload</dt><dd>${proposal.bytes} bytes · ${p.source.files.length} file sides</dd><dt>Approved hash</dt><dd>${esc(proposal.payloadHash)}</dd></dl>
<table><thead><tr><th>Path</th><th>Side</th><th>Bytes</th></tr></thead><tbody>${p.source.files.map((f) => `<tr><td>${esc(f.metadata.path)}</td><td>${esc(f.metadata.side)}</td><td>${f.metadata.byteLength}</td></tr>`).join("")}</tbody></table>
<details><summary>Full source, knowledge, model and budget payload</summary><pre>${esc(JSON.stringify(p, null, 2))}</pre></details>
<p>Closing this preview makes no submission. After submission, stopping the local wait does not prove server cancellation. Central Model Requests can inspect or cancel the recorded request.</p>
<button id="approve">Approve upload and run</button><button id="cancel">Cancel</button>
<script nonce="${nonce}">const api=acquireVsCodeApi();document.getElementById('approve').onclick=()=>{api.postMessage({action:'approve',hash:${JSON.stringify(proposal.payloadHash)}});document.getElementById('approve').disabled=true;};document.getElementById('cancel').onclick=()=>api.postMessage({action:'cancel'});</script></body></html>`;
}
function confirmRemote(
  proposal: RemoteProposal,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  const panel = vscode.window.createWebviewPanel(
    "commitDefender.remoteApproval",
    "Approve Central Review",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [],
    },
  );
  panel.webview.html = remoteApprovalHtml(
    proposal,
    randomBytes(18).toString("base64"),
  );
  return new Promise((resolve) => {
    let settled = false;
    const finish = (hash?: string) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      message.dispose();
      closed.dispose();
      panel.dispose();
      resolve(hash);
    };
    const abort = () => finish();
    const message = panel.webview.onDidReceiveMessage((value) => {
      if (value?.action === "approve" && value.hash === proposal.payloadHash)
        finish(value.hash);
      else if (value?.action === "cancel") finish();
    });
    const closed = panel.onDidDispose(() => finish());
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
export async function prepareRemoteWithUi(
  request: ReviewRequest,
  settings: StandaloneReviewSettings,
  scope: LocalScope,
  signal: AbortSignal,
  assertCurrent: () => void,
  ports: CentralPorts = {},
) {
  const cancellation = new vscode.CancellationTokenSource();
  const abort = () => cancellation.cancel();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    const choice = await withCentralConnection(
      scope,
      async (manager) => {
        const entries = (await manager.list()).filter(
          (c) =>
            c.status === "connected" &&
            c.clientId === "commit-defender" &&
            (settings.mode !== "centralized" || c.id === settings.connectionId),
        );
        const connection = await vscode.window.showQuickPick(
          entries.map((c) => ({
            label: c.serverUrl,
            description: c.audience.repositoryId,
            detail: `User ${c.audience.userId}`,
            id: c.id,
          })),
          {
            title: "Central execution connection",
            placeHolder: "Choose the server authorized to receive this review",
          },
          cancellation.token,
        );
        if (!connection)
          throw new RemoteModelReviewError("selection-cancelled");
        assertCurrent();
        const catalog = await manager.remoteReviewModels(connection.id, signal);
        if (!catalog.enabled || !catalog.models.length)
          throw new RemoteModelReviewError("no-authorized-central-model");
        const model = await vscode.window.showQuickPick(
          catalog.models.map((m) => ({
            label: m.displayName,
            description: m.accountName,
            detail: m.name,
            model: m,
          })),
          {
            title: "Central account and model",
            placeHolder:
              "Registry authorization is checked again before execution",
          },
          cancellation.token,
        );
        if (!model) throw new RemoteModelReviewError("selection-cancelled");
        const effort = await vscode.window.showQuickPick(
          model.model.allowedEfforts.map((value) => ({
            label: value,
            description:
              value === model.model.defaultEffort ? "Account default" : "",
            value,
          })),
          { title: "Reasoning effort" },
          cancellation.token,
        );
        if (!effort) throw new RemoteModelReviewError("selection-cancelled");
        return {
          connectionId: connection.id,
          accountId: model.model.accountId,
          name: model.model.name,
          reasoningEffort: effort.value,
        };
      },
      ports,
    );
    assertCurrent();
    return await prepareRemoteModelReview(
      request,
      settings,
      choice,
      signal,
      { confirm: confirmRemote, assertCurrent },
      ports,
    );
  } finally {
    signal.removeEventListener("abort", abort);
    cancellation.dispose();
  }
}
/** Explicit read/cancel actions can resume after an extension host restart; never resubmit source. */
export async function manageRemoteRequests(
  scope: LocalScope,
  assertCurrent: () => void,
  ports: CentralPorts = {},
) {
  return withCentralConnection(
    scope,
    async (manager) => {
      const entries = (await manager.list()).filter(
        (c) => c.status === "connected" && c.clientId === "commit-defender",
      );
      const selected = await vscode.window.showQuickPick(
        entries.map((c) => ({
          label: c.serverUrl,
          description: c.audience.repositoryId,
          id: c.id,
        })),
        { title: "Central Model Requests: connection" },
      );
      if (!selected) return;
      assertCurrent();
      const client = await RemoteReviewClient.open({
        scope,
        ...ports,
        connectionId: selected.id,
        connections: manager,
      });
      try {
        const rows = await client.list();
        const row = await vscode.window.showQuickPick(
          rows.map((r) => ({
            label: r.handle.requestId,
            description: r.status?.state ?? "unconfirmed",
            detail: `${r.handle.model} · ${r.handle.selected.length} files`,
            value: r,
          })),
          {
            title: "Central Model Requests",
            placeHolder:
              "Choose an existing request; no new review will be submitted",
          },
        );
        if (!row) return;
        const action = await vscode.window.showQuickPick(
          [
            { label: "Refresh status", action: "status" },
            { label: "Read verified result", action: "result" },
            { label: "Request cancellation", action: "cancel" },
          ],
          { title: row.label },
        );
        if (!action) return;
        assertCurrent();
        if (action.action === "result") {
          const result = await client.result(row.label);
          assertCurrent();
          return projectCommitDefender(result.report);
        }
        if (action.action === "cancel") {
          const confirmed = await vscode.window.showWarningMessage(
            `Cancel central review ${row.label}?`,
            { modal: true },
            "Request cancellation",
          );
          if (confirmed !== "Request cancellation") return;
          assertCurrent();
        }
        const state =
          action.action === "cancel"
            ? await client.cancel(row.label)
            : await client.refresh(row.label);
        assertCurrent();
        void vscode.window.showInformationMessage(
          `Central request ${row.label}: ${state.status?.state ?? "unconfirmed"}${state.cancellationRequested ? "; cancellation was requested" : ""}.`,
        );
      } finally {
        client.close();
      }
    },
    ports,
  );
}
