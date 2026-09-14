import * as vscode from "vscode";
import type { CentralKnowledgeSnapshot } from "@gcr/client-core";

const esc = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const text = (label: string, value: unknown) =>
  `<h4>${esc(label)}</h4><pre>${esc(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre>`;

/** Render verified projections as text; downloaded Markdown never becomes executable HTML. */
export function centralKnowledgeHtml(
  snapshot: CentralKnowledgeSnapshot,
): string {
  const { payload } = snapshot.manifest;
  const sections = Object.entries(snapshot.bundles)
    .map(([part, bundle]) => {
      const release =
        payload.components[part as keyof typeof payload.components];
      let content: string;
      if (bundle.component === "policy") {
        const skills = bundle.skills.skills
          .map(
            (skill) =>
              `<details><summary>${esc(skill.title)} · v${skill.version} · ${skill.enabled ? "Enabled" : "Disabled"}</summary>${text("Instructions", skill.instructions)}${text("Prompt document", skill.markdown)}${text("Source", `${skill.name} · ${skill.contentHash}`)}</details>`,
          )
          .join("");
        const criteria = bundle.criteria
          .map(
            (rule) =>
              `<details><summary>${esc(rule.document.title)} · ${esc(rule.document.severity)} · revision ${rule.revision}</summary>${text("Requirement", rule.document.requirement)}${text("Rationale", rule.document.rationale)}${text("Review steps", rule.document.reviewSteps)}${text("Counter-evidence", rule.document.counterEvidence)}${text("Applies to", rule.document.appliesTo)}${text("Exceptions", rule.exceptions)}${text("Source", { id: rule.id, contentHash: rule.contentHash, decision: rule.decision })}</details>`,
          )
          .join("");
        content = `<h3>Prompts (${bundle.skills.skills.length})</h3>${skills}<h3>Review criteria (${bundle.criteria.length})</h3>${criteria || "<p>No published review criteria.</p>"}`;
      } else {
        content =
          bundle.memories
            .map(
              (memory) =>
                `<details><summary>${esc(memory.content.summary)} · revision ${memory.revision}</summary>${text("Review knowledge", memory.content.detail)}${text("Recommendation", memory.content.recommendation)}${text("Applies to", memory.content.appliesTo)}${text("Counter-evidence", memory.content.counterEvidence)}${text("Expires", memory.content.expiresAt ?? "No item expiry")}${text("Source", { id: memory.id, kind: memory.kind, contentHash: memory.contentHash, sources: memory.sources })}</details>`,
            )
            .join("") || "<p>No published memories.</p>";
      }
      const title =
        part === "policy"
          ? "Review criteria and prompts"
          : part === "collective"
            ? "Shared review knowledge"
            : "Your centrally published memories";
      return `<section><h2>${title}</h2><p>Release ${release.releaseSequence} · ${esc(release.bundleId)}</p>${content}</section>`;
    })
    .join("");
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;max-width:1000px}details{border-bottom:1px solid var(--vscode-panel-border);padding:12px 0}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;line-height:1.5}h4{margin-bottom:4px}section{margin-top:32px}</style></head><body><h1>Downloaded review knowledge</h1><p>Read-only content from the central server. Reviews run with your locally configured model. Local code, results and conversations are not uploaded.</p><p>Repository ${esc(payload.audience.repositoryId)} · User ${esc(payload.audience.userId)}<br>Snapshot ${esc(payload.snapshotId)}<br>Signed cache valid until ${esc(payload.offlineValidUntil)}</p><p>This is the complete downloaded snapshot. Each review selects relevant items for its source and records the items it used.</p>${sections}</body></html>`;
}

/** Recheck local access on focus, lease expiry and while the panel remains open. */
export function showCentralKnowledge(
  context: vscode.ExtensionContext,
  snapshot: CentralKnowledgeSnapshot,
  validate: () => Promise<void>,
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    "commitDefender.centralKnowledge",
    "Downloaded review knowledge",
    vscode.ViewColumn.Active,
    { enableScripts: false, localResourceRoots: [] },
  );
  panel.webview.html = centralKnowledgeHtml(snapshot);
  let closed = false;
  let checking = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expires = Date.parse(snapshot.manifest.payload.offlineValidUntil);
  const check = async () => {
    if (closed || checking) return;
    checking = true;
    try {
      if (Date.now() >= expires) throw Error("expired");
      await validate();
    } catch {
      // Remove displayed personal/central content on access loss or scope change.
      if (!closed) {
        panel.webview.html = "";
        panel.dispose();
        void vscode.window.showInformationMessage(
          "Downloaded review knowledge was closed because its connection, access, or snapshot changed. Reopen the view to read the current authorized content.",
        );
      }
    } finally {
      checking = false;
    }
  };
  const schedule = () => {
    if (closed) return;
    timer = setTimeout(
      async () => {
        await check();
        schedule();
      },
      Math.max(1, Math.min(30_000, expires - Date.now())),
    );
    timer.unref();
  };
  panel.onDidDispose(() => {
    closed = true;
    if (timer) clearTimeout(timer);
  });
  panel.onDidChangeViewState(() => {
    void check();
  });
  context.subscriptions.push(panel);
  schedule();
  return panel;
}
