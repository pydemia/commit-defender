import { randomBytes } from "node:crypto";
import type { SubmissionSelection } from "./reviewSubmissionSession.js";
export type SubmissionMessage =
  | { command: "ready" | "refresh" }
  | { command: "prepare"; selection: SubmissionSelection }
  | {
      command:
        "select" | "cancel" | "review-status" | "synchronize" | "open-central";
      id: string;
    }
  | { command: "rereview"; id: string }
  | { command: "save" | "send" | "memory"; hash: string };
export class ReviewSubmissionView {
  readonly id = randomBytes(16).toString("hex");
  message(raw: unknown): SubmissionMessage | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const v = raw as Record<string, unknown>;
    const exact = (keys: string[]) =>
      Object.keys(v).length === keys.length + 2 &&
      Object.keys(v).every((k) => ["command", "viewId", ...keys].includes(k));
    if (v.viewId !== this.id) return;
    if ((v.command === "ready" || v.command === "refresh") && exact([]))
      return { command: v.command };
    if (
      [
        "select",
        "cancel",
        "review-status",
        "synchronize",
        "open-central",
      ].includes(String(v.command)) &&
      exact(["id"]) &&
      typeof v.id === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(v.id)
    )
      return {
        command: v.command as
          | "select"
          | "cancel"
          | "review-status"
          | "synchronize"
          | "open-central",
        id: v.id,
      };
    if (
      v.command === "rereview" &&
      exact(["id", "confirmed"]) &&
      v.confirmed === true &&
      typeof v.id === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(v.id)
    )
      return { command: "rereview", id: v.id };
    if (
      ["save", "send", "memory"].includes(String(v.command)) &&
      exact(["hash", "confirmed"]) &&
      v.confirmed === true &&
      typeof v.hash === "string" &&
      /^[a-f0-9]{64}$/.test(v.hash)
    )
      return { command: v.command as "save" | "send" | "memory", hash: v.hash };
    if (
      v.command !== "prepare" ||
      !exact(["selection"]) ||
      !v.selection ||
      typeof v.selection !== "object" ||
      Array.isArray(v.selection)
    )
      return;
    const s = v.selection as Record<string, unknown>;
    if (s.kind === "result" && Object.keys(s).length === 1)
      return { command: "prepare", selection: { kind: "result" } };
    if (
      s.kind !== "feedback" ||
      !["correction", "exception", "judgment"].includes(
        String(s.feedbackKind),
      ) ||
      typeof s.message !== "string" ||
      !s.message.trim() ||
      s.message.length > 4000 ||
      typeof s.includeSourceReference !== "boolean" ||
      (s.findingId !== undefined &&
        (typeof s.findingId !== "string" ||
          !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(s.findingId))) ||
      Object.keys(s).some(
        (k) =>
          ![
            "kind",
            "feedbackKind",
            "message",
            "findingId",
            "includeSourceReference",
          ].includes(k),
      )
    )
      return;
    return {
      command: "prepare",
      selection: {
        kind: "feedback",
        feedbackKind: s.feedbackKind as "correction" | "exception" | "judgment",
        message: s.message,
        includeSourceReference: s.includeSourceReference,
        ...(s.findingId ? { findingId: s.findingId as string } : {}),
      },
    };
  }
  html() {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${this.id}'; script-src 'nonce-${this.id}';">
<title>Review feedback</title><style nonce="${this.id}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:20px;max-width:880px;margin:auto;line-height:1.5}
h1{font-size:1.5em}h2{font-size:1.15em;margin-top:24px}label{display:block;margin:10px 0}select,textarea,button{font:inherit}textarea,select{box-sizing:border-box;width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-widget-border));padding:8px}textarea{resize:vertical;min-height:110px}button{cursor:pointer;margin:4px 8px 4px 0;padding:6px 10px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:1px solid transparent}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--vscode-textCodeBlock-background);padding:12px}#destination,#status,.entry{overflow-wrap:anywhere}.entry{border-top:1px solid var(--vscode-widget-border);padding:10px 0}#status{min-height:24px}#status.error{color:var(--vscode-errorForeground)}[hidden]{display:none!important}.hint{color:var(--vscode-descriptionForeground)}
</style></head><body><h1>Submit review feedback</h1>
<p id="destination">Checking the selected central connection…</p>
<p class="hint">Visible to authorized repository reviewers. Submissions are retained for 30 days and recorded as client-reported evidence. A receipt confirms delivery; it does not approve a rule or exception.</p>
<fieldset id="editor" disabled><legend>Choose what to share</legend>
<label>Submission type<select id="kind"><option value="feedback">Feedback</option><option value="result">Review status and counts</option></select></label>
<div id="feedbackFields"><label>Feedback type<select id="feedbackKind"><option value="correction">Correction / false positive</option><option value="exception">Exception request</option><option value="judgment">New judgment</option></select></label>
<label>Finding (optional)<select id="finding"><option value="">Review as a whole</option></select></label>
<label>Feedback message<textarea id="message" maxlength="4000" placeholder="Describe the correction, exception, or judgment for repository reviewers."></textarea></label>
<label><input id="source" type="checkbox"> Include the selected finding’s file path, line range, and source hash</label></div>
<button id="prepare" type="button">Preview submission</button></fieldset>
<section id="previewSection" hidden><h2>Confirm the exact content</h2>
<p class="hint">Only the fields below are sent. Check your message for private information before sharing. Source bodies, review prose, chat history, and local knowledge are not added automatically.</p>
<pre id="payload"></pre><label><input id="confirmed" type="checkbox"> I have checked the destination, visibility, and content shown above.</label>
<button id="send" disabled>Submit now</button><button id="save" class="secondary" disabled>Save to outbox</button><button id="memory" class="secondary" disabled>Save feedback as a local memory candidate</button>
<p class="hint">Outbox entries are sent only when you choose Submit now. A local memory candidate stays on this device and requires activation in Local Knowledge.</p></section>
<p id="status" role="status" aria-live="polite"></p>
<h2>Outbox for this review</h2><button id="refresh" class="secondary" disabled>Refresh outbox</button>
<p class="hint">If delivery is unconfirmed, retrying the same entry uses the same request ID. Cancelling stops local retries and cannot retract a submission already received by the server.</p><div id="outbox"></div>
<section id="followupSection" hidden><h2>Central review status</h2><p id="followupTitle"></p><p id="followupState"></p><p id="followupNote"></p><p id="followupChecked" class="hint"></p><p id="syncState"></p>
<button id="synchronize" class="secondary">Synchronize central policy</button><button id="rereview" disabled>Review these files again</button><p id="reviewScope" class="hint"></p></section>
<script nonce="${this.id}">
const vscode=acquireVsCodeApi(),viewId='${this.id}',el=id=>document.getElementById(id);
let busy=true,preview=null,ready=false,followup=null;
const post=(command,extra={})=>vscode.postMessage({command,viewId,...extra});
function controls(){el('editor').disabled=busy||!ready;el('refresh').disabled=busy||!ready;for(const id of ['send','save','memory'])el(id).disabled=busy||!preview||!el('confirmed').checked||(id==='memory'&&preview.submission.kind!=='feedback');for(const b of el('outbox').querySelectorAll('button'))b.disabled=busy;el('confirmed').disabled=busy;el('synchronize').disabled=busy||!followup;el('rereview').disabled=busy||!followup?.rereviewAllowed;}
function invalidate(){preview=null;el('confirmed').checked=false;el('previewSection').hidden=true;controls();}
function request(command,extra={}){if(busy)return;busy=true;el('status').className='';el('status').textContent=command==='send'?'Submitting…':'Checking…';controls();post(command,extra);}
el('editor').addEventListener('input',invalidate);
el('kind').addEventListener('change',()=>{el('feedbackFields').hidden=el('kind').value==='result';invalidate();});
el('confirmed').addEventListener('change',controls);
el('prepare').onclick=()=>{const selection=el('kind').value==='result'?{kind:'result'}:{kind:'feedback',feedbackKind:el('feedbackKind').value,message:el('message').value,includeSourceReference:el('source').checked,...(el('finding').value?{findingId:el('finding').value}:{})};if(selection.kind==='feedback'&&!selection.message.trim()){el('status').textContent='Enter a feedback message.';return;}request('prepare',{selection});};
for(const command of ['send','save','memory'])el(command).onclick=()=>{if(preview&&el('confirmed').checked){request(command,{hash:preview.payloadHash,confirmed:true});el('confirmed').checked=false;controls();}};
el('refresh').onclick=()=>request('refresh');
el('synchronize').onclick=()=>{if(followup)request('synchronize',{id:followup.id});};
el('rereview').onclick=()=>{if(followup?.rereviewAllowed)request('rereview',{id:followup.id,confirmed:true});};
window.addEventListener('message',event=>{const m=event.data;if(!m||m.viewId!==viewId)return;
if(m.type==='state'){
ready=true;
if(m.destination){const a=m.destination.audience;el('destination').textContent='Server: '+m.destination.serverUrl+' | Repository: '+a.repositoryId+' | Tenant: '+a.tenantId+' | User: '+a.userId+' | Server ID: '+a.serverId;}
if(m.reviewScope)el('reviewScope').textContent=m.reviewScope;
if(m.followup){followup=m.followup;el('followupSection').hidden=false;el('followupTitle').textContent=followup.title;el('followupState').textContent=followup.state;el('followupNote').textContent=followup.note;el('followupChecked').textContent='Checked at '+new Date(followup.checkedAt).toLocaleString();el('syncState').textContent=followup.sync;}
if(m.findings){el('finding').replaceChildren(new Option('Review as a whole',''));for(const f of m.findings)el('finding').append(new Option(f.title,f.id));}
if(m.preview){preview=m.preview;el('payload').textContent=JSON.stringify(preview.submission,null,2);el('confirmed').checked=false;el('previewSection').hidden=false;}
if(m.entries){el('outbox').replaceChildren();if(!m.entries.length)el('outbox').textContent='No saved submissions for this review.';for(const entry of m.entries){const row=document.createElement('div');row.className='entry';const p=document.createElement('p');p.textContent=entry.payload.kind+' · '+entry.status+' · '+entry.payload.id+(entry.receipt?' · Received '+entry.receipt.receivedAt+' · Expires '+entry.receipt.expiresAt:'')+(entry.lastError?' · '+entry.lastError:'');row.append(p);const b=document.createElement('button');b.textContent='View exact content';b.className='secondary';b.onclick=()=>request('select',{id:entry.payload.id});row.append(b);if(entry.receipt){for(const [command,label] of [['review-status','Check central review status'],['open-central','Open central criteria']]){const c=document.createElement('button');c.textContent=label;c.className='secondary';c.onclick=()=>request(command,{id:entry.payload.id});row.append(c);}}if(['pending','rejected'].includes(entry.status)){const c=document.createElement('button');c.textContent='Cancel local retries';c.className='secondary';c.onclick=()=>request('cancel',{id:entry.payload.id});row.append(c);}el('outbox').append(row);}}
el('status').className='';el('status').textContent=m.message||'';
}else if(m.type==='error'){followup=null;el('followupSection').hidden=true;el('status').className='error';el('status').textContent=m.message;}
else return;
busy=false;controls();
});
post('ready');
</script></body></html>`;
  }
}
