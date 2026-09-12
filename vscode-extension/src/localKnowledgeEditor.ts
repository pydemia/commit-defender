import { type LocalKnowledge, knowledgeAppliesTo } from "@gcr/client-contract";
import type { LocalKnowledgeEdit } from "@gcr/client-core";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
const emptyAppliesTo = { paths: [], languages: [], symbols: [], branches: [] };

interface EditorValues {
  title: string;
  body: string;
  paths: string;
  languages: string;
  symbols: string;
  branches: string;
  rationale: string;
  counterEvidence: string;
  expiresAt: string;
}
export function knowledgeEditorValues(value: unknown): EditorValues {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid editor message.");
  const keys = [
    "title",
    "body",
    "paths",
    "languages",
    "symbols",
    "branches",
    "rationale",
    "counterEvidence",
    "expiresAt",
  ];
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== keys.length ||
    keys.some((key) => typeof data[key] !== "string") ||
    JSON.stringify(value).length > 1_000_000
  )
    throw Error("Invalid editor message.");
  if (!(data.title as string).trim()) throw Error("Enter a title.");
  if (!(data.body as string).trim()) throw Error("Enter the knowledge body.");
  return data as unknown as EditorValues;
}
const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
export function knowledgeEditorChanges(
  value: EditorValues,
  kind: LocalKnowledge["kind"],
): LocalKnowledgeEdit {
  const expiresAt = value.expiresAt.trim();
  if (
    expiresAt &&
    (!Number.isFinite(Date.parse(expiresAt)) ||
      new Date(expiresAt).toISOString() !== expiresAt)
  )
    throw Error(
      "Expiry must be an ISO UTC timestamp, such as 2026-12-31T23:59:59.000Z, or blank.",
    );
  return {
    title: value.title,
    body: value.body,
    appliesTo: knowledgeAppliesTo({
      paths: lines(value.paths),
      languages: lines(value.languages),
      symbols: lines(value.symbols),
      branches: lines(value.branches),
    }),
    expiresAt: expiresAt || null,
    ...(kind === "memory"
      ? {
          rationale: value.rationale,
          counterEvidence: lines(value.counterEvidence),
        }
      : {}),
  };
}

export function localKnowledgeHtml(
  nonce: string,
  scopeLabel: string,
  records: LocalKnowledge[],
  selected?: LocalKnowledge,
  createKind?: LocalKnowledge["kind"],
  notice = "",
): string {
  const kind = selected?.kind ?? createKind;
  const applies = selected?.appliesTo ?? emptyAppliesTo;
  const field = (
    name: string,
    label: string,
    value: string,
    multiline = false,
  ) =>
    `<label>${escapeHtml(label)}${
      multiline
        ? `<textarea name="${name}" rows="${name === "body" ? 12 : 3}">${escapeHtml(value)}</textarea>`
        : `<input name="${name}" value="${escapeHtml(value)}">`
    }</label>`;
  const rows = records
    .map(
      (
        record,
      ) => `<tr><td><button data-action="select" data-id="${escapeHtml(record.id)}">${escapeHtml(record.title)}</button></td>
    <td>${escapeHtml(record.kind)}</td><td>${escapeHtml(record.state)}</td><td>${record.revision}</td><td>${escapeHtml(record.expiresAt ?? "No expiry")}</td></tr>`,
    )
    .join("");
  const editor = kind
    ? `<h2>${selected ? "Edit" : "New"} ${kind === "memory" ? "Memory" : "Skill"}</h2>
    ${
      selected
        ? `<p>ID <code>${escapeHtml(selected.id)}</code> · Revision ${selected.revision} · ${escapeHtml(selected.state)}</p>
      <p>Content hash <code>${escapeHtml(selected.hash)}</code></p>
      <details><summary>Sources</summary><pre>${escapeHtml(JSON.stringify(selected.sources, null, 2))}</pre></details>`
        : "<p>New entries start as candidates. Activate an entry to use it in reviews.</p>"
    }
    <form id="editor">${field("title", "Title", selected?.title ?? "")}
    ${field("body", "Body", selected?.body ?? "", true)}
    ${field("paths", "Paths (one glob per line; blank means all)", applies.paths.join("\n"), true)}
    ${field("languages", "Languages (one per line)", applies.languages.join("\n"), true)}
    ${field("symbols", "Symbols (one per line)", applies.symbols.join("\n"), true)}
    ${field("branches", "Branches (one glob per line)", applies.branches.join("\n"), true)}
    ${field("expiresAt", "Expiry (ISO UTC timestamp; optional)", selected?.expiresAt ?? "")}
    ${field("rationale", "Rationale (Memory)", selected?.kind === "memory" ? selected.rationale : "", true)}
    ${field("counterEvidence", "Counter-evidence (Memory; one note per line)", selected?.kind === "memory" ? selected.counterEvidence.join("\n") : "", true)}
    <button type="button" data-action="save">Save ${selected ? "revision" : "candidate"}</button></form>
    ${
      selected
        ? `<p><button data-action="active">Activate</button><button data-action="inactive">Deactivate</button>
      <button data-action="archived">Archive</button><button data-action="export">Export…</button><button data-action="delete">Delete…</button></p>`
        : ""
    }`
    : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none'">
    <style nonce="${nonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:20px;max-width:1000px}button{font:inherit;margin:4px;padding:6px 12px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;cursor:pointer}label{display:block;margin:14px 0}input,textarea{display:block;box-sizing:border-box;width:100%;font:inherit;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:7px}textarea,pre{white-space:pre-wrap;overflow-wrap:anywhere}td,th{text-align:left;padding:7px}code{overflow-wrap:anywhere}.notice{white-space:pre-wrap}</style></head><body>
    <h1>Local Memory and Skills</h1><p>${escapeHtml(scopeLabel)}</p>
    <p>Saved in encrypted local storage. Active entries may be sent to the selected review model as context. Entries are not uploaded to a GCR server. Skills describe review guidance; they cannot grant tool or execution permissions.</p>
    <p><button data-action="new-memory">New Memory</button><button data-action="new-skill">New Skill</button><button data-action="import">Import…</button><button data-action="refresh">Refresh</button></p>
    <p class="notice" role="status">${escapeHtml(notice)}</p><table><thead><tr><th>Title</th><th>Kind</th><th>State</th><th>Revision</th><th>Expiry</th></tr></thead><tbody>${rows}</tbody></table>${editor}
    <script nonce="${nonce}">const vscode=acquireVsCodeApi();document.addEventListener('click',event=>{const button=event.target.closest('button[data-action]');if(!button)return;event.preventDefault();let values;if(button.dataset.action==='save')values=Object.fromEntries(new FormData(document.getElementById('editor')));vscode.postMessage({nonce:'${nonce}',action:button.dataset.action,id:button.dataset.id,values});});document.addEventListener('submit',event=>event.preventDefault());</script></body></html>`;
}
