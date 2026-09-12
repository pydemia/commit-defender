import { randomBytes } from "crypto";
import { normalizedSourcePath } from "./sourcePolicy.js";
import {
  attachReviewSources,
  liveSource,
  sourceAnchor,
  validLine,
} from "./reviewSource.js";
import { webLink } from "./reviewMarkdown.js";
import type { AnalysisReport } from "./types.js";

export type ReviewLink =
  | {
      kind: "source";
      repoRoot: string;
      report: AnalysisReport;
      file: string;
      line: number;
    }
  | { kind: "web"; url: string };

/** Requests carry opaque IDs, never model-authored paths or command arguments. */
export class ReviewLinks {
  private targets = new Map<string, ReviewLink>();
  clear(): void { this.targets.clear(); }
  constructor(private readonly limit = 4096) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("Invalid review link limit");
  }
  private issue(target: ReviewLink): string {
    const id = randomBytes(16).toString("hex");
    this.targets.set(id, target);
    while (this.targets.size > this.limit)
      this.targets.delete(this.targets.keys().next().value as string);
    return id;
  }
  get(id: unknown): ReviewLink | undefined {
    return typeof id === "string" ? this.targets.get(id) : undefined;
  }
  source(
    repoRoot: string,
    report: AnalysisReport,
    file: string,
    line: unknown = 1,
  ): string | undefined {
    if (!normalizedSourcePath(file) || !report.staged_files.includes(file))
      return undefined;
    let anchor = sourceAnchor(report, file);
    if (!anchor && !report.source_snapshot && !report.source_anchors) {
      // A legacy report has no captured source identity; validate and freeze its current source now.
      const text = liveSource(repoRoot, report, file);
      if (text === undefined) return undefined;
      report = { ...report, source_snapshot: undefined };
      attachReviewSources(report, new Map([[file, text]]));
      anchor = sourceAnchor(report, file);
    }
    if (!anchor || !validLine(line, anchor.line_count)) return undefined;
    return this.issue({
      kind: "source",
      repoRoot,
      report,
      file,
      line: Math.max(1, line),
    });
  }
  markdown(
    repoRoot: string,
    report: AnalysisReport,
    raw: string,
    currentFile?: string,
  ): string | undefined {
    const external = webLink(raw);
    if (external) return this.issue({ kind: "web", url: external });
    if (
      /[\x00-\x1f\x7f]/.test(raw) ||
      /^[a-z][a-z0-9+.-]*:/i.test(raw) ||
      raw.startsWith("//") ||
      raw.includes("?")
    )
      return undefined;
    const match = /^(.*?)(?:#L([1-9]\d*)(?:-L?([1-9]\d*))?|:([1-9]\d*))?$/.exec(
      raw,
    );
    if (!match) return undefined;
    let file: string;
    try {
      file = decodeURIComponent(match[1] || currentFile || "").replace(
        /^\.\//,
        "",
      );
    } catch {
      return undefined;
    }
    const line = match[2] || match[4] ? Number(match[2] || match[4]) : 1;
    if (match[3]) {
      const end = Number(match[3]);
      const anchor = sourceAnchor(report, file);
      if (!anchor || !validLine(end, anchor.line_count) || end < line)
        return undefined;
    }
    return this.source(repoRoot, report, file, line);
  }
}

export function reviewMessage(
  value: unknown,
  viewId: string,
  allowed: ReadonlySet<string>,
): { command: "open"; id: string } | { command: "showJson" } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const message = value as Record<string, unknown>;
  if (message.viewId !== viewId) return undefined;
  if (
    message.command === "showJson" &&
    Object.keys(message).every((key) => ["command", "viewId"].includes(key))
  )
    return { command: "showJson" };
  if (
    message.command === "open" &&
    typeof message.id === "string" &&
    allowed.has(message.id) &&
    Object.keys(message).every((key) =>
      ["command", "viewId", "id"].includes(key),
    )
  )
    return { command: "open", id: message.id };
  return undefined;
}
