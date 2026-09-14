import { reviewExecutionLabel } from "./reviewExecutionLabel.js";
import { randomBytes } from "crypto";
import {
  AnalysisReport,
  CommentBlock,
  CommentPriority,
  PRIORITY_META,
} from "./types.js";
import {
  normalizeReport,
  worstPriority,
  metaForBlock,
  formatCategory,
  PRIORITY_RANK,
} from "./commentFormatter.js";
import {
  Palette,
  resolvePalette,
  gradeColor as paletteGradeColor,
} from "./palette.js";
import { OUTCOME_META, reviewCoverage, reviewStatus } from "./reviewOutcome.js";
import { resolveExitCode } from "./exitResolver.js";
import { ReviewLinks, reviewMessage } from "./reviewLinks.js";
import { safeMarkdownHtml } from "./reviewMarkdown.js";

/** Each render has its own message nonce and exact set of permitted link IDs. */
export class SummaryView {
  readonly id = randomBytes(16).toString("hex");
  private readonly allowed = new Set<string>();
  readonly html: string;
  constructor(
    readonly report: AnalysisReport,
    readonly repoRoot: string,
    private readonly links: ReviewLinks,
    palette?: Palette,
  ) {
    this.html = buildSummaryHtml(report, this, palette);
  }
  message(value: unknown): ReturnType<typeof reviewMessage> | { command: 'discuss' } {
    if (this.report.gcr && value && typeof value === 'object' && !Array.isArray(value)) {
      const message = value as Record<string, unknown>;
      if (message.command === 'discuss' && message.viewId === this.id && Object.keys(message).every(key => ['command', 'viewId'].includes(key))) return { command: 'discuss' };
    }
    return reviewMessage(value, this.id, this.allowed);
  }
  private href(id: string | undefined): string | undefined {
    if (!id) return undefined;
    this.allowed.add(id);
    return `#review-link-${id}`;
  }
  source(file: string, line: number, label: string): string {
    const href = this.href(
      this.links.source(this.repoRoot, this.report, file, line),
    );
    return href ? `<a href="${href}">${esc(label)}</a>` : esc(label);
  }
  markdown(text: string, file?: string): string {
    return safeMarkdownHtml(text, (raw) =>
      this.href(this.links.markdown(this.repoRoot, this.report, raw, file)),
    );
  }
}

function _renderOverallSummary(
  review: AnalysisReport["review"],
  blocks: CommentBlock[],
  view: SummaryView,
  palette: Palette,
): string {
  const perFile = review.per_file_summaries ?? [];

  if (perFile.length === 0) {
    return `<div class="per-file-summary">${view.markdown(review.summary)}</div>`;
  }

  const worstByFile = new Map<string, CommentPriority>();
  for (const b of blocks) {
    const cur = worstByFile.get(b.file);
    if (!cur || PRIORITY_RANK[b.priority] > PRIORITY_RANK[cur]) {
      worstByFile.set(b.file, b.priority);
    }
  }

  let html = "";
  for (const pfs of perFile) {
    const priority = worstByFile.get(pfs.file) ?? pfs.priority;
    const pMeta = priority ? PRIORITY_META[priority] : undefined;
    const pColor = priority ? palette.priority[priority] : undefined;
    const badge = pMeta
      ? `<span class="priority-badge" style="color:${pColor}">${pMeta.emoji} ${priority} ${pMeta.label}</span>`
      : "";
    html += `<div class="per-file-summary">
      <div class="per-file-header">
        <code>${view.source(pfs.file, 1, pfs.file)}</code>
        ${pfs.status ? `<span class="mode-tag">${esc(pfs.status)}</span>` : ""} ${badge}
      </div>
      <div class="per-file-body">${view.markdown(pfs.summary, pfs.file)}</div>
    </div>`;
  }
  return html;
}

function _renderFileBlocks(
  blocks: CommentBlock[],
  view: SummaryView,
  palette: Palette,
): string {
  const byFile = new Map<string, CommentBlock[]>();
  for (const b of blocks) {
    const list = byFile.get(b.file) ?? [];
    list.push(b);
    byFile.set(b.file, list);
  }
  let html = "";
  for (const [relFile, fileBlocks] of byFile) {
    html += `<div class="file-block">
      <div class="file-name">
        ${view.source(relFile, 1, relFile)}
      </div>`;
    for (const b of fileBlocks) {
      const meta = metaForBlock(b);
      const cat = formatCategory(b.category);
      const catSlug = (b.category || "").toLowerCase();
      const pColor = palette.priority[b.priority];
      const pBadge = `<span class="priority-badge" style="color:${pColor}">${meta.emoji} ${b.priority} ${meta.label}</span>`;
      const catBadge =
        b.priority !== "P0" && b.category
          ? `<span class="cat cat-${esc(catSlug)}">${esc(cat)}</span>`
          : "";
      const lineRef =
        b.line > 0
          ? view.source(b.file, b.line, `line ${b.line}`)
          : '<span class="line-label">file-level</span>';
      const bodyHtml = view.markdown(b.comment, b.file);
      html += `<div class="suggestion priority-${esc(b.priority)}">
        <div class="suggestion-header">${pBadge} ${catBadge} &nbsp;${lineRef}</div>
        <div class="suggestion-body">${bodyHtml}</div>
      </div>`;
    }
    html += "</div>";
  }
  return html;
}

function buildSummaryHtml(
  report: AnalysisReport,
  view: SummaryView,
  palette?: Palette,
): string {
  const pal = palette ?? resolvePalette("theme-adaptive");
  const blocks = normalizeReport(report);

  const status = reviewStatus(report.review);
  const outcome = OUTCOME_META[status];
  const grade = status === "completed" ? report.review.grade : "";
  const isError = status === "failed";
  const wp = worstPriority(blocks);
  const wpMeta = wp ? PRIORITY_META[wp] : undefined;
  const headerBadge = `<span class="badge" style="background:var(--vscode-${outcome.color.replaceAll(".", "-")})">${outcome.label.toUpperCase()}</span>`;
  const gradeBadge = grade
    ? `<span class="badge" style="background:${paletteGradeColor(pal, grade)}">${esc(grade.toUpperCase())}</span>`
    : "";
  const worstBadge =
    wpMeta && wp
      ? `<span class="priority-badge" style="color:${pal.priority[wp]}">${wpMeta.emoji} ${wp} ${wpMeta.label}</span>`
      : "";

  const metaParts: string[] = [
    reviewCoverage(report),
    blocks.length > 0 ? `${blocks.length} comment(s)` : "",
    report.gcr ? `${reviewExecutionLabel(report.gcr.report.identity.client)} · advisory` : `Legacy hook: ${resolveExitCode(report) === 1 ? "would block" : "allows commit"}`,
    `${report.duration_ms} ms`,
  ].filter(Boolean);

  let body = `
    <div class="header">
      <div class="header-row">
        <h1>🛡 Commit Defender &nbsp;${headerBadge} ${gradeBadge} &nbsp;${worstBadge}</h1>
        ${report.gcr ? '<button class="json-btn" id="btnDiscuss">Discuss review</button>' : ''}
        <button class="json-btn" id="btnShowJson" title="Open raw JSON report in editor">{ } Raw JSON</button>
      </div>
      <div class="meta">${metaParts.map(esc).join(" &nbsp;·&nbsp; ")}</div>
    </div>`;

  if (report.gcr) {
    const core = report.gcr.report;
    if (core.problems.length) {
      body += `<section><h2>Review problems</h2><ul>${core.problems.map(problem =>
        `<li><code>${esc(problem.code)}</code>: ${esc(problem.message)}</li>`).join("")}</ul></section>`;
    }
    const execution = core.identity.client.execution;
    if (execution) body += `<section><h2>Review execution</h2><p>Configured mode: ${esc(execution.configuredMode)} · Effective mode: ${esc(execution.effectiveMode)} · Knowledge: ${esc(execution.knowledgeSource)}</p>
      ${execution.fallbackReason ? `<p>Fallback reason: ${esc(execution.fallbackReason)}. ${execution.effectiveMode === "standalone" ? "This review used local/built-in knowledge only and does not establish compliance with central policy." : "This review used the authorized signed cache."}</p>` : ""}
      ${execution.lastSynchronizedAt ? `<p>Last successful knowledge sync: ${esc(execution.lastSynchronizedAt)}</p>` : ""}</section>`;
    const central = core.identity.context.centralSnapshot;
    if (central) body += `<section><h2>Central knowledge used</h2>
      <p>Server ${esc(central.audience.serverId)} · Tenant ${esc(central.audience.tenantId)} · Repository ${esc(central.audience.repositoryId)} · User ${esc(central.audience.userId)}</p>
      <p>Snapshot <code>${esc(central.id)}</code> · <code>${esc(central.hash)}</code><br>Signed offline validity: ${esc(central.offlineValidUntil)}</p>
      <p>This report records the snapshot used during review. Open Central Review Connection to check its current authorization and cache status.</p></section>`;
    const freshness = report.local_context_freshness;
    const current = !freshness ? "Current local entries have not been checked."
      : freshness.status === "current" ? "The local entries used by this review still match their saved active revisions. Newly added entries apply to the next review."
      : freshness.status === "stale" ? "One or more local entries used by this review changed, expired or became inactive. Run another review to use current context."
      : "Current local entries could not be checked. The report retains the context captured when it ran.";
    body += `<section><h2>Review source and context</h2><p>${esc(current)}</p>
      ${freshness ? `<p>Checked ${esc(freshness.checkedAt)}</p>` : ""}
      <p>Run <code>${esc(core.runId)}</code> · ${esc(core.identity.source.kind)} · ${esc(core.finishedAt ?? "No completion timestamp")}</p>
      <p>Source <code>${esc(core.identity.source.hash)}</code><br>Context <code>${esc(core.identity.context.hash)}</code></p>
      <p>Executor ${esc(core.identity.executor.id)} · ${esc(core.identity.executor.model)}</p>
      <details><summary>Review criteria used</summary><ul>${core.identity.context.entries.map(entry =>
        `<li>${esc(entry.origin)} ${esc(entry.kind)}: <code>${esc(entry.id)}</code> · revision ${entry.revision} · <code>${esc(entry.hash)}</code></li>`).join("")}</ul></details>
      ${freshness?.changes.length ? `<ul>${freshness.changes.map(change => `<li><code>${esc(change.id)}</code>: ${esc(change.reason)}</li>`).join("")}</ul>` : ""}
      </section><section><h2>Evidence</h2>
      <p>Source-read observations record returned source ranges. Anchor validation checks positions. Neither records execution of tests.</p>
      ${core.findings.map(finding => `<details><summary>${esc(finding.title)} · ${esc(finding.evidenceAssessment.level)}</summary>
        <p>Anchor: ${esc(finding.anchorValidation.status)} — ${esc(finding.anchorValidation.reason)}</p>
        <p>${view.markdown(finding.evidenceAssessment.rationale)}</p>
        <p>Counter-evidence: ${esc(finding.evidenceAssessment.counterEvidence.status)}</p>
        <p>${view.markdown(finding.evidenceAssessment.counterEvidence.summary)}</p></details>`).join("")}
      <ul>${core.evidence.map(evidence => `<li>${esc(evidence.kind)} · ${esc(evidence.provenance.kind)}${evidence.kind === "source-read"
        ? ` · ${esc(evidence.location.path)}:${evidence.location.startLine}–${evidence.location.endLine} (${esc(evidence.location.side)}) · <code>${esc(evidence.location.hash)}</code>` : ""}</li>`).join("")}</ul></section>`;
  }

  if (report.review.rejected_finding_count) {
    body += `<p class="summary-error">${esc(String(report.review.rejected_finding_count))} invalid finding(s) rejected. Review output is incomplete.</p>`;
  }

  if (report.source_exclusions?.length) {
    body += `<section><h2>Source coverage</h2><p>${report.staged_files.length} file(s) selected; ${report.source_exclusions.length} path(s) excluded. Excluded paths may include whole directories.</p><ul>`;
    for (const entry of report.source_exclusions) {
      body += `<li><code>${esc(JSON.stringify(entry.path))}</code>: ${esc(entry.reason)}</li>`;
    }
    body += "</ul></section>";
  }

  if (report.review.summary) {
    if (isError) {
      const txt = report.review.summary.replace(
        /^AI review unavailable:\s*/i,
        "",
      );
      body += `<section><h2>⚠ AI Review Error</h2>
        <div class="summary-error">${view.markdown(txt)}</div></section>`;
    } else {
      body += `<section><h2>📋 Overall Summary</h2>
        ${_renderOverallSummary(report.review, blocks, view, pal)}</section>`;
    }
  }

  if (blocks.length > 0) {
    body += "<section><h2>💡 AI Comments</h2>";
    body += _renderFileBlocks(blocks, view, pal);
    body += "</section>";
  }

  if (report.staged_files.length > 0) {
    body += '<section><h2>📁 Selected File List</h2><ul class="file-list">';
    for (const f of report.staged_files) {
      body += `<li><code>${view.source(f, 1, f)}</code></li>`;
    }
    body += "</ul></section>";
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${view.id}'; style-src 'nonce-${view.id}'; style-src-attr 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style nonce="${view.id}">
  :root {
    --radius: 6px;
    --cd-p3: ${pal.priority.P3};
    --cd-p2: ${pal.priority.P2};
    --cd-p1: ${pal.priority.P1};
    --cd-p0: ${pal.priority.P0};
    --cd-cat-security:        ${pal.category.security};
    --cd-cat-correctness:     ${pal.category.correctness};
    --cd-cat-maintenance:     ${pal.category.maintenance};
    --cd-cat-optimization:    ${pal.category.optimization};
    --cd-cat-setting:         ${pal.category.setting};
    --cd-cat-review-history:  ${pal.category["review-history"]};
  }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 32px;
    line-height: 1.65;
    max-width: 960px;
  }
  h1 { font-size: 1.3em; margin: 0 0 6px; }
  h2 { font-size: 1em; font-weight: 600; margin: 1.8em 0 0.6em;
       border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 4px; }
  a  { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    font-family: var(--vscode-editor-font-family);
    background: var(--vscode-textBlockQuote-background);
    padding: 1px 5px; border-radius: 3px; font-size: 0.88em;
  }
  .header { margin-bottom: 1.4em; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 4px; }
  .badge {
    display: inline-block; padding: 2px 12px; border-radius: 4px;
    font-size: 0.78em; font-weight: 700; margin-left: 8px; vertical-align: middle;
  }
  .badge.pass    { background: #2d7d46; color: #fff; }
  .badge.blocked { background: var(--vscode-statusBarItem-errorBackground, #c72e2e); color: #fff; }
  .mode-tag { display: inline-block; font-size: 0.78em; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); vertical-align: middle; }
  .file-block { margin-bottom: 1.2em; }
  .file-name { font-size: 0.88em; font-weight: 600; margin-bottom: 4px; color: var(--vscode-descriptionForeground); }
  .suggestion {
    background: var(--vscode-textBlockQuote-background);
    border-left: 3px solid var(--vscode-textLink-foreground);
    border-radius: 0 var(--radius) var(--radius) 0;
    padding: 8px 14px; margin: 5px 0;
  }
  .suggestion-header { font-size: 0.85em; margin-bottom: 5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .priority-badge { font-weight: 600; white-space: nowrap; }
  .suggestion.priority-P3 { border-left: 3px solid var(--cd-p3); padding-left: 8px; }
  .suggestion.priority-P2 { border-left: 3px solid var(--cd-p2); padding-left: 8px; }
  .suggestion.priority-P1 { border-left: 3px solid var(--cd-p1); padding-left: 8px; }
  .suggestion.priority-P0 { border-left: 3px solid var(--cd-p0); padding-left: 8px; }
  .suggestion-body p { margin: 4px 0; }
  .line-label { color: var(--vscode-descriptionForeground); font-size: 0.82em; }
  .cat {
    display: inline-block; font-size: 0.72em; font-weight: 600;
    padding: 1px 6px; border-radius: 3px; margin-left: 6px;
    vertical-align: middle; text-transform: uppercase;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  .cat-security       { background: var(--cd-cat-security);        color: #fff; }
  .cat-correctness    { background: var(--cd-cat-correctness);     color: #fff; }
  .cat-maintenance    { background: var(--cd-cat-maintenance);     color: #fff; }
  .cat-optimization   { background: var(--cd-cat-optimization);    color: #fff; }
  .cat-setting        { background: var(--cd-cat-setting);         color: #fff; }
  .cat-review-history { background: var(--cd-cat-review-history);  color: #fff; }
  .file-list { margin: 4px 0; padding-left: 20px; }
  .file-list li { margin: 2px 0; font-size: 0.88em; }
  .summary-text p { margin: 6px 0; }
  .per-file-summary {
    padding: 10px 0;
    border-bottom: 1px solid var(--vscode-widget-border);
  }
  .per-file-summary:last-child { border-bottom: none; }
  .per-file-header {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 6px; flex-wrap: wrap;
  }
  .per-file-header code {
    font-size: 0.9em;
    background: var(--vscode-textBlockQuote-background);
  }
  .per-file-body p { margin: 4px 0; }
  .summary-error {
    background: var(--vscode-inputValidation-errorBackground, rgba(199,46,46,0.15));
    border-left: 3px solid var(--vscode-errorForeground);
    border-radius: 0 var(--radius) var(--radius) 0;
    padding: 10px 14px;
  }
  section { margin-bottom: 1.6em; }
  .header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .header-row h1 { margin: 0; flex: 1; }
  .json-btn {
    cursor: pointer;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.78em;
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
    background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    white-space: nowrap;
  }
  .json-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
</style>
</head>
<body>
${body}
<script nonce="${view.id}">
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    const link = e.target.closest('a');
    if (link) {
      e.preventDefault();
      const href = link.getAttribute('href') || '';
      if (/^#review-link-[a-f0-9]{32}$/.test(href)) {
        vscode.postMessage({ command: 'open', viewId: '${view.id}', id: href.slice(13) });
      }
    } else if (e.target.closest('#btnDiscuss')) {
      vscode.postMessage({ command: 'discuss', viewId: '${view.id}' });
    } else if (e.target.closest('#btnShowJson')) {
      vscode.postMessage({ command: 'showJson', viewId: '${view.id}' });
    }
  });
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
