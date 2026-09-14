import * as vscode from "vscode";
import {
  summarizeLocalReviews,
  type LocalReviewObservations,
} from "@gcr/client-core";
import type { ClientReviewReport, LocalScope } from "@gcr/client-contract";

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
const rows = (values: Array<[string, unknown]>) =>
  values
    .map(
      ([label, value]) =>
        `<tr><th scope="row">${escape(label)}</th><td>${escape(value)}</td></tr>`,
    )
    .join("");
export function localReviewActivityHtml(
  value: LocalReviewObservations,
  profile: string,
  repository: string,
): string {
  const countRows = (values: Record<string, number>) =>
    rows(Object.entries(values));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Local Review Activity</title><style>
body{font-family:var(--vscode-font-family, sans-serif);color:var(--vscode-foreground);padding:16px;line-height:1.5;max-width:960px;margin:auto;overflow-wrap:anywhere}table{width:100%;table-layout:fixed;border-collapse:collapse;margin-bottom:24px}th,td{padding:8px;text-align:left;vertical-align:top;border-bottom:1px solid var(--vscode-panel-border,#8885);overflow-wrap:anywhere}th{width:60%;font-weight:500}h2{font-size:1.2em;margin-top:28px}p{max-width:80ch}.notice{border-left:3px solid var(--vscode-editorWarning-foreground,#ad7b00);padding-left:12px}
</style></head><body><h1>Local Review Activity</h1><p>Profile: ${escape(profile)}<br>Worktree: ${escape(repository)}</p><p>Saved reviews finished in the last ${value.days} days.<br>${escape(value.from)} – ${escape(value.observedAt)}</p><p>Run <strong>Commit Defender: Local Review Activity</strong> again to refresh or choose 7, 30 or 90 days.</p>
${value.coverage.incompleteHistory ? '<p class="notice">The selected central connection’s local history is unavailable. Only saved local fallback reviews for that connection are included.</p>' : ""}
<h2>Recorded reviews</h2><table>${rows([
    ["Included in this period", value.coverage.includedRecords],
    ["Available unique records", value.coverage.availableRecords],
    ["Duplicate records excluded", value.coverage.duplicateRecords],
    ["Future-dated records excluded", value.coverage.futureRecords],
  ])}</table>
<p>Deleted or unsaved runs are unknown. Retention limits may remove older records. An empty period does not establish that no reviews ran.</p>
<h2>Terminal status</h2><table>${countRows(value.statuses) || "<tr><td>No saved reviews in this period.</td></tr>"}</table>
<h2>Recorded triggers</h2><table>${countRows(value.triggers) || "<tr><td>No recorded triggers.</td></tr>"}</table><p>Each saved run counts once under its recorded trigger. Combined request reasons are not inferred.</p>
<h2>Review duration</h2><table>${rows([
    ["Records with a start time", value.duration.startedRecords],
    ["Records without a start time", value.duration.unstartedRecords],
    ["Sum of reported duration (ms)", value.duration.reportedMs],
    ["Provider calls / tokens / billed cost", "Unknown — not recorded"],
  ])}</table><p>Reported duration covers the review run, including overhead. It is not provider latency. A recorded start does not establish that a model was called.</p>
<h2>Knowledge selected for local execution</h2><table>${rows([
    ["Local knowledge", value.knowledge.local],
    ["Central download", value.knowledge.centralOnline],
    ["Signed central cache", value.knowledge.centralCache],
    ["Source not recorded", value.knowledge.unrecorded],
    ["Pinned central snapshot", value.knowledge.withPinnedSnapshot],
    ["Selected public criteria", value.knowledge.withSelectedPublicCriteria],
    ["Local fallback", value.knowledge.withLocalFallback],
  ])}</table><p>These counts describe saved input provenance. They do not measure compliance, review quality or defect prevention.</p>
<h2>Recorded findings</h2><table>${countRows(value.findings)}</table><table>${countRows(value.findingOutcomes)}</table><p>Severity counts include every recorded outcome. Repeated findings in separate reviews count separately; these are not unique confirmed defects.</p>
<h2>Recorded executor and model</h2><table>${value.models.map((model) => `<tr><th scope="row">${escape(model.executor)} / ${escape(model.model)}</th><td>${model.reviews} reviews</td></tr>`).join("") || "<tr><td>No model identity recorded in this period.</td></tr>"}</table>${value.omittedModelGroups ? `<p>${value.omittedModelGroups} additional model groups omitted from this list.</p>` : ""}<p>Saved executor identity includes runs that did not reach a model call. This view reads local encrypted history without model calls, central synchronization or uploads.</p></body></html>`;
}
export interface LocalActivityHistory {
  scope: LocalScope;
  repository: string;
  reports: ClientReviewReport[];
  incompleteHistory: boolean;
}
/** Read a snapshot of authorized history; invalidate whenever the selected scope changes. */
export class LocalReviewActivity implements vscode.Disposable {
  private generation = 0;
  private panel: vscode.WebviewPanel | undefined;
  constructor(private readonly read: () => Promise<LocalActivityHistory>) {}
  dispose(): void {
    this.generation++;
    this.panel?.dispose();
    this.panel = undefined;
  }
  async show(requestedDays?: unknown): Promise<void> {
    const generation = ++this.generation;
    try {
      if (
        requestedDays !== undefined &&
        ![7, 30, 90].includes(requestedDays as number)
      )
        throw Error("Invalid period");
      const days =
        requestedDays ??
        (
          await vscode.window.showQuickPick(
            [7, 30, 90].map((days) => ({ label: `Last ${days} days`, days })),
            { title: "Local Review Activity: period" },
          )
        )?.days;
      if (days === undefined || generation !== this.generation) return;
      const data = await this.read();
      if (generation !== this.generation) return;
      const summary = summarizeLocalReviews(data.reports, {
        scope: data.scope,
        days: days as 7 | 30 | 90,
        incompleteHistory: data.incompleteHistory,
      });
      this.panel?.dispose();
      this.panel = vscode.window.createWebviewPanel(
        "commitDefender.localReviewActivity",
        "Local Review Activity",
        vscode.ViewColumn.Active,
        { enableScripts: false, localResourceRoots: [] },
      );
      this.panel.webview.html = localReviewActivityHtml(
        summary,
        data.scope.profileId,
        data.repository,
      );
    } catch {
      if (generation !== this.generation) return;
      this.panel?.dispose();
      this.panel = undefined;
      void vscode.window.showErrorMessage(
        "Local review activity could not be loaded. Check the selected profile, connection and OS credential store.",
      );
    }
  }
}
