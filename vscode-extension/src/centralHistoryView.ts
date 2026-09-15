import * as vscode from "vscode";
import {
  reviewHistoryPullPage,
  reviewHistoryMessagePage,
  reviewHistoryDetail,
  type ReviewHistoryRequest,
  type ReviewHistoryResponse,
} from "@gcr/client-contract";
import { showAuthorizedCentralText } from "./centralKnowledgeView.js";
type Read = (
  request: ReviewHistoryRequest,
) => Promise<{
  data: ReviewHistoryResponse;
  cached: boolean;
  fetchedAt: string;
  expiresAt: string;
}>;
const esc = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function centralHistoryHtml(
  title: string,
  result: Awaited<ReturnType<Read>>,
): string {
  const render = (value: unknown): string => {
    const item = value as Record<string, any>;
    if (item.snapshot)
      return `<article><h2>Observed ${esc(item.observedAt)}</h2>${render(item.snapshot)}<p>Observation ${esc(item.observationHash)}</p></article>`;
    if (item.content)
      return `<article><h2>${esc(item.content.summary)}</h2><p>${esc(item.state)}${item.needsReview ? " · Needs review" : ""}</p><pre>${esc(item.content.recommendation)}</pre><h3>Applies to</h3><pre>${esc(JSON.stringify(item.content.appliesTo, null, 2))}</pre><h3>Counter-evidence</h3><ul>${item.content.counterEvidence.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul><p>Source: ${esc(item.source.htmlUrl)}</p></article>`;
    if ("body" in item || "excerpt" in item)
      return `<article><h2>${esc(item.authorLogin ?? item.githubUpdatedAt ?? "Body version")}</h2><p>${esc(item.kind ?? "")} · ${esc(item.path ?? "PR discussion")}${item.line ? ":" + esc(item.line) : ""} · ${esc(item.upstreamState ?? "")}</p><pre>${esc(item.body ?? item.excerpt)}</pre><p>Source: ${esc(item.htmlUrl ?? "")}</p><details><summary>Version and thread metadata</summary><pre>${esc(JSON.stringify({ id: item.id, contentHash: item.contentHash, observationHash: item.observationHash, updatedAt: item.githubUpdatedAt, observedAt: item.observedAt, replyTo: item.inReplyToGithubId, provenance: item.provenance }, null, 2))}</pre></details></article>`;
    return `<pre>${esc(JSON.stringify(item, null, 2))}</pre>`;
  };
  const data = result.data;
  const content =
    "item" in data
      ? render(data.item)
      : "items" in data
        ? data.items.map(render).join("") || "<p>No entries in this page.</p>"
        : render(data);
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'"><style>body{font-family:var(--vscode-font-family);padding:24px;max-width:1000px}pre{font-family:inherit;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}article{padding:16px 0;border-bottom:1px solid var(--vscode-panel-border)}p{overflow-wrap:anywhere}</style></head><body><h1>${esc(title)}</h1><p>${result.cached ? "Cached history" : "Central history"} · fetched ${esc(result.fetchedAt)} · access lease ${esc(result.expiresAt)}</p><p>These are past review observations. A reply, resolved thread or merge is not proof of a current fix. Original history does not require memory approval.</p>${content}</body></html>`;
}
/** Existing connection menu owns scope and credentials. All navigation sends
 * server IDs; this UI has no local text search or write endpoint. */
export async function browseCentralHistory(
  context: vscode.ExtensionContext,
  read: Read,
  validate: () => Promise<void>,
): Promise<void> {
  let cursor: string | undefined;
  let pullNumber: number | undefined;
  while (!pullNumber) {
    const page = reviewHistoryPullPage(
      (await read({ kind: "pulls", ...(cursor ? { cursor } : {}) })).data,
    );
    const choice = await vscode.window.showQuickPick(
      [
        ...page.items.map((p) => ({
          label: `#${p.number} ${p.title}`,
          description: `${p.messageCount} comments · ${p.coverage.state}`,
          number: p.number,
          more: false,
        })),
        ...(page.nextCursor
          ? [{ label: "Next page", description: "", number: 0, more: true }]
          : []),
      ],
      { title: "Central PR history" },
    );
    if (!choice) return;
    await validate();
    if (choice.more) cursor = page.nextCursor!;
    else pullNumber = choice.number;
  }
  cursor = undefined;
  while (true) {
    const page = reviewHistoryMessagePage(
      (
        await read({
          kind: "messages",
          pullNumber,
          ...(cursor ? { cursor } : {}),
        })
      ).data,
    );
    const choice = await vscode.window.showQuickPick(
      [
        ...page.items.map((m) => ({
          label: `${m.authorLogin}: ${m.excerpt.replace(/\s+/g, " ").slice(0, 120)}`,
          description: `${m.kind} · ${m.path ?? "PR"} · ${m.upstreamState}`,
          sourceId: m.id,
          more: false,
        })),
        ...(page.nextCursor
          ? [{ label: "Next page", description: "", sourceId: "", more: true }]
          : []),
      ],
      { title: `PR #${pullNumber} comments and replies` },
    );
    if (!choice) return;
    await validate();
    if (choice.more) {
      cursor = page.nextCursor!;
      continue;
    }
    const sourceId = choice.sourceId;
    const original = await read({ kind: "message", pullNumber, sourceId });
    const detail = reviewHistoryDetail(original.data);
    let panel = showAuthorizedCentralText(
      context,
      `PR #${pullNumber} · original comment`,
      centralHistoryHtml("Original comment and source", original),
      Date.parse(original.expiresAt),
      validate,
    );
    try {
      let historyCursor: string | undefined;
      let lastKind:
        "replies" | "guidance" | "versions" | "observations" | undefined;
      while (true) {
        const action = await vscode.window.showQuickPick(
          [
            { label: "Original comment", action: "message" },
            { label: "Replies", action: "replies" },
            { label: "Body versions", action: "versions" },
            { label: "Thread observations", action: "observations" },
            { label: "Source-linked guidance", action: "guidance" },
            ...(historyCursor && lastKind
              ? [{ label: "Next history page", action: "next" }]
              : []),
          ],
          { title: "Read source history · Escape to return to comments" },
        );
        if (!action) break;
        const kind = action.action === "next" ? lastKind! : action.action;
        const request: ReviewHistoryRequest =
          kind === "replies"
            ? {
                kind: "messages",
                pullNumber,
                parentId: detail.item.parentId ?? sourceId,
              }
            : kind === "guidance"
              ? { kind: "guidance", sourceId }
              : {
                  kind: kind as "message" | "versions" | "observations",
                  pullNumber,
                  sourceId,
                  ...(action.action === "next" && historyCursor
                    ? { cursor: historyCursor }
                    : {}),
                };
        if (action.action === "next" && historyCursor)
          request.cursor = historyCursor;
        const result = await read(request);
        await validate();
        historyCursor =
          "nextCursor" in result.data
            ? (result.data.nextCursor ?? undefined)
            : undefined;
        lastKind =
          kind === "versions" ||
          kind === "observations" ||
          kind === "replies" ||
          kind === "guidance"
            ? kind
            : undefined;
        panel.dispose();
        panel = showAuthorizedCentralText(
          context,
          `PR #${pullNumber} · ${kind}`,
          centralHistoryHtml(action.label, result),
          Date.parse(result.expiresAt),
          validate,
        );
      }
    } finally {
      panel.dispose();
    }
  }
}
