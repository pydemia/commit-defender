import { randomBytes } from "node:crypto";
import {
  localReviewConversation,
  clientReviewReport,
} from "@gcr/client-contract";
import { safeMarkdownHtml } from "./reviewMarkdown.js";
import type { ReviewChatState } from "./reviewChatProtocol.js";
const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const markdown = (text: string) => safeMarkdownHtml(text, () => undefined);
export type ChatMessage =
  | { command: "ready" | "refresh" | "cancel" | "resume" }
  | { command: "send"; content: string }
  | { command: "source" | "finding"; id: string };
export class ReviewChatView {
  readonly id = randomBytes(16).toString("hex");
  private revision = 0;
  private sources = new Map<string, { turnId: string; citation: number }>();
  private findings = new Map<string, string>();
  state?: ReviewChatState;
  source(id: string) {
    return this.sources.get(id);
  }
  finding(id: string) {
    return this.findings.get(id);
  }
  message(value: unknown): ChatMessage | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const m = value as Record<string, unknown>;
    if (m.viewId !== this.id) return;
    const keys = [
      "command",
      "viewId",
      ...(m.command === "ready" ? [] : ["revision"]),
      ...(m.command === "send"
        ? ["content"]
        : ["source", "finding"].includes(String(m.command))
          ? ["id"]
          : []),
    ];
    if (
      Object.keys(m).some((k) => !keys.includes(k)) ||
      (m.command !== "ready" && m.revision !== this.revision)
    )
      return;
    if (["ready", "refresh", "cancel", "resume"].includes(String(m.command)))
      return {
        command: m.command as "ready" | "refresh" | "cancel" | "resume",
      };
    if (
      m.command === "send" &&
      typeof m.content === "string" &&
      m.content.trim().length > 0 &&
      m.content.length <= 4000
    )
      return { command: "send", content: m.content };
    if (
      (m.command === "source" || m.command === "finding") &&
      typeof m.id === "string" &&
      (m.command === "source" ? this.sources : this.findings).has(m.id)
    )
      return { command: m.command, id: m.id };
    return;
  }
  render(value: ReviewChatState) {
    this.state = {
      conversation: localReviewConversation(value.conversation),
      review: clientReviewReport(value.review),
    };
    this.revision++;
    this.sources.clear();
    this.findings.clear();
    const { conversation: chat, review } = this.state;
    const last = chat.turns.at(-1),
      waiting = last?.status === "awaiting_input",
      queued = last?.status === "queued",
      running = last?.status === "running";
    const limits = chat.limits;
    const summary = `<details><summary>Review summary and findings</summary><div>${markdown(review.summary)}</div><ul>${review.findings
      .map((f) => {
        const id = randomBytes(12).toString("hex");
        this.findings.set(id, `Explain finding ${f.id}: ${f.title}`);
        return `<li><button class="link" data-finding="${id}">${esc(f.title)}</button></li>`;
      })
      .join("")}</ul></details>`;
    const turns = chat.turns
      .map((t) => {
        const questions = t.questions
          .map(
            (q) =>
              `<section class="question"><h3>Confirmation needed</h3><p>${esc(q.question)}</p>${q.answer !== null ? `<div class="user">${esc(q.answer)}</div>` : `<div>${q.options.map((option) => `<button class="option" data-option="${esc(option)}">${esc(option)}</button>`).join("")}</div><small>Expires ${esc(q.expiresAt)}</small>`}</section>`,
          )
          .join("");
        const citations = (t.response?.citations ?? [])
          .map((c, index) => {
            const id = randomBytes(12).toString("hex");
            this.sources.set(id, { turnId: t.id, citation: index });
            return `<li><button class="link" data-source="${id}">${esc(c.location.side)} · ${esc(c.location.path)}:${c.location.startLine}–${c.location.endLine}</button></li>`;
          })
          .join("");
        return `<article><div class="user">${esc(t.content)}</div>${questions}${t.response ? `<div class="answer">${markdown(t.response.content)}</div>${citations ? `<details open><summary>Source evidence</summary><ul>${citations}</ul></details>` : ""}` : ""}<p class="turn-status">${esc(t.status)}${t.error ? ` · ${esc(t.error)}` : ""}${["running", "failed", "cancelled"].includes(t.status) ? " · budget reserved; final usage unconfirmed" : ` · ${t.usage.modelCalls} model call(s)`}</p></article>`;
      })
      .join("");
    return {
      type: "state",
      viewId: this.id,
      revision: this.revision,
      html: `${summary}${turns || '<p class="empty">Ask about a finding or how the reviewed code behaves. Source evidence will link to the saved review version.</p>'}`,
      meta: `${chat.identity.client.mode} · ${chat.identity.executor.model} · source ${chat.identity.source.hash.slice(0, 12)} · per turn: ${limits.modelCalls} model calls, ${Math.round(limits.durationMs / 1000)}s, ${Math.round(limits.sourceBytes / 1024)} KiB`,
      placeholder: waiting
        ? "Answer the confirmation question…"
        : "Ask about this review…",
      sendLabel: waiting ? "Answer and resume" : "Send",
      canSend: !chat.closed && !running && !queued,
      canResume: !!queued,
      canCancel:
        !!last && ["queued", "running", "awaiting_input"].includes(last.status),
      status: waiting
        ? "Waiting for your answer. No model process is running."
        : running
          ? "A conversation step is running. Refresh to check its result, or cancel it."
          : queued
            ? "A saved turn is ready. Resume when you want to continue."
            : "Ready",
    };
  }
  get html() {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${this.id}'; style-src 'nonce-${this.id}'; base-uri 'none'; form-action 'none'"><title>Review conversation</title><style nonce="${this.id}">
body{font:var(--vscode-font-size)/1.6 var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);max-width:900px;margin:0 auto;padding:20px;box-sizing:border-box}h1{font-size:1.35em;margin:0}h3{font-size:1em;margin:0 0 8px}.meta,small,.turn-status{font-size:.9em;color:var(--vscode-descriptionForeground)}header{margin-bottom:20px}article{padding:20px 0;border-bottom:1px solid var(--vscode-panel-border)}.user{white-space:pre-wrap;padding:10px 14px;border-left:3px solid var(--vscode-focusBorder);background:var(--vscode-textBlockQuote-background)}.answer{margin-top:16px}.question{margin:16px 0;padding:12px;border:1px solid var(--vscode-panel-border)}button{font:inherit;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:1px solid transparent;border-radius:3px;padding:5px 12px}button:hover{background:var(--vscode-button-hoverBackground)}button:disabled{opacity:.5;cursor:default}.link{background:none;color:var(--vscode-textLink-foreground);padding:0;text-align:left}.option{margin:4px 8px 4px 0;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}textarea{box-sizing:border-box;width:100%;resize:vertical;min-height:90px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));padding:10px;font:inherit}textarea:focus,button:focus-visible{outline:1px solid var(--vscode-focusBorder)}footer{position:sticky;bottom:0;padding:16px 0;background:var(--vscode-editor-background)}.actions{display:flex;gap:8px;align-items:center;margin-top:8px}#status{min-height:1.6em;margin:6px 0}#error{color:var(--vscode-errorForeground);white-space:pre-wrap}pre{overflow:auto;padding:12px;background:var(--vscode-textCodeBlock-background)}code{font-family:var(--vscode-editor-font-family)}summary{cursor:pointer}ul{padding-left:22px}label{display:block;font-weight:600;margin-bottom:6px}[hidden]{display:none!important}
</style></head><body><header><h1>Review conversation</h1><p id="meta" class="meta">Opening the saved review…</p></header><main id="transcript"></main><footer><div id="status" role="status" aria-live="polite">Loading…</div><div id="error" role="alert"></div><label for="message">Your question or answer</label><textarea id="message" maxlength="4000" disabled></textarea><div class="actions"><button id="send" disabled>Send</button><button id="resume" hidden>Resume</button><button id="cancel" hidden>Cancel turn</button><button id="refresh">Refresh</button><small>Enter to send · Shift+Enter for a new line</small></div></footer><script nonce="${this.id}">
const api=acquireVsCodeApi(), viewId='${this.id}', $=id=>document.getElementById(id);let revision=0,busy=false,canSend=false;
const saved=api.getState();$('message').value=saved?.draft||'';
const remember=()=>api.setState({draft:$('message').value});
const post=(command,extra={})=>api.postMessage({command,viewId,...(command==='ready'?{}:{revision}),...extra});
const controls=()=>{$('send').disabled=busy||!canSend||!$('message').value.trim();$('message').disabled=busy||!canSend};
$('message').addEventListener('input',()=>{remember();controls()});
const send=()=>{if(busy||!canSend||!$('message').value.trim())return;post('send',{content:$('message').value});busy=true;controls()};
$('send').onclick=send;$('message').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send()}});
$('cancel').onclick=()=>post('cancel');$('resume').onclick=()=>{if(!busy){busy=true;controls();post('resume')}};$('refresh').onclick=()=>post('refresh');
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.source)post('source',{id:b.dataset.source});if(b.dataset.finding)post('finding',{id:b.dataset.finding});if(b.dataset.option){$('message').value=b.dataset.option;remember();controls();$('message').focus()}});
window.addEventListener('message',event=>{const m=event.data;if(m?.viewId!==viewId)return;if(m.type==='state'){revision=m.revision;$('transcript').innerHTML=m.html;$('meta').textContent=m.meta;canSend=m.canSend;$('message').placeholder=m.placeholder;$('send').textContent=m.sendLabel;$('resume').hidden=!m.canResume;$('cancel').hidden=!m.canCancel;$('status').textContent=m.status;busy=false;controls()}else if(m.type==='progress'){busy=true;$('status').textContent=m.message;$('cancel').hidden=false;controls()}else if(m.type==='error'){busy=false;$('error').textContent=m.message;controls()}else if(m.type==='accepted'){if($('message').value===m.content){$('message').value='';remember()}$('error').textContent=''}else if(m.type==='draft'){$('message').value=m.content;remember();controls();$('message').focus()}});
post('ready');
</script></body></html>`;
  }
}
