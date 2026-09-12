import { createHash } from "crypto";
import * as path from "path";
import { readGitTreeFile } from "./gitSnapshot.js";
import {
  normalizedSourcePath,
  readReviewFile,
  selectReviewInputs,
} from "./sourcePolicy.js";
import type {
  AnalysisReport,
  CommentBlock,
  ReviewResult,
  SourceAnchor,
} from "./types.js";

export function sourceHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
export function validLine(line: unknown, count: number): line is number {
  return (
    typeof line === "number" &&
    Number.isSafeInteger(line) &&
    line >= 0 &&
    line <= count
  );
}

/** Bounded, in-memory source view cache. Nothing is written as plaintext history. */
export class SourceViewCache {
  private values = new Map<string, string>();
  private bytes = 0;
  constructor(private readonly limit = 8 * 1024 * 1024) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("Invalid source cache limit");
  }
  put(text: string): string {
    const hash = sourceHash(text);
    const size = Buffer.byteLength(text);
    if (size > this.limit || this.values.has(hash)) return hash;
    while (this.bytes + size > this.limit) {
      const first = this.values.keys().next().value as string;
      this.bytes -= Buffer.byteLength(this.values.get(first)!);
      this.values.delete(first);
    }
    this.values.set(hash, text);
    this.bytes += size;
    return hash;
  }
  get(hash: string): string | undefined {
    return this.values.get(hash);
  }
}
export const sourceViews = new SourceViewCache();

export function attachReviewSources(
  report: AnalysisReport,
  sources: ReadonlyMap<string, string>,
  sideOf: (file: string) => "base" | "source" = () => "source",
): void {
  report.source_anchors = Object.fromEntries(
    [...sources].map(([file, content]) => [
      file,
      {
        sha256: sourceViews.put(content),
        line_count: content.split(/\r?\n/).length,
        side: sideOf(file),
      },
    ]),
  );
}

export function sourceAnchor(
  report: AnalysisReport,
  file: string,
): SourceAnchor | undefined {
  if (!normalizedSourcePath(file) || !report.staged_files.includes(file))
    return undefined;
  if (!report.source_anchors || !Object.hasOwn(report.source_anchors, file))
    return undefined;
  const anchor = report.source_anchors[file];
  return anchor &&
    /^[a-f0-9]{64}$/.test(anchor.sha256) &&
    Number.isSafeInteger(anchor.line_count) &&
    anchor.line_count >= 1 &&
    (anchor.side === "base" || anchor.side === "source")
    ? anchor
    : undefined;
}

export function rejectFindings(review: ReviewResult, count: number): void {
  if (!count) return;
  review.rejected_finding_count = (review.rejected_finding_count ?? 0) + count;
  if (review.status === "completed") review.status = "partial";
  review.grade = "";
  review.incomplete_reasons = [
    ...new Set([
      ...(review.incomplete_reasons ?? []),
      "invalid-output" as const,
    ]),
  ];
}

/** Only a basename alias for the one supplied file is accepted; arbitrary paths are never rewritten. */
export function validateFindingAnchors(
  review: ReviewResult,
  sources: ReadonlyMap<string, string>,
  singleFile?: string,
): void {
  let rejected = 0;
  review.file_comments = review.file_comments.flatMap((comment) => {
    const file =
      singleFile && comment.file === path.posix.basename(singleFile)
        ? singleFile
        : comment.file;
    const content = sources.get(file);
    if (
      !normalizedSourcePath(file) ||
      content === undefined ||
      !validLine(comment.line, content.split(/\r?\n/).length)
    ) {
      rejected++;
      return [];
    }
    return [{ ...comment, file }];
  });
  rejectFindings(review, rejected);
}

export function readRecordedSource(
  repoRoot: string,
  report: AnalysisReport,
  file: string,
): string | undefined {
  const anchor = sourceAnchor(report, file);
  if (!anchor) return undefined;
  const cached = sourceViews.get(anchor.sha256);
  if (cached !== undefined) return cached;
  try {
    const snapshot = report.source_snapshot;
    const text =
      snapshot?.kind === "index"
        ? readGitTreeFile(
            repoRoot,
            anchor.side === "base" ? snapshot.base_tree : snapshot.source_tree,
            file,
          )
        : readReviewFile(repoRoot, file);
    return text !== undefined && sourceHash(text) === anchor.sha256
      ? text
      : undefined;
  } catch {
    return undefined;
  }
}

/** File overlays require the current bytes to match the captured source. */
export function liveSource(
  repoRoot: string,
  report: AnalysisReport,
  file: string,
  editorText?: string,
): string | undefined {
  if (!normalizedSourcePath(file) || !report.staged_files.includes(file))
    return undefined;
  if (sourceAnchor(report, file)?.side === "base") return undefined;
  try {
    if (!selectReviewInputs(repoRoot, [file]).files.length) return undefined;
    const text = editorText ?? readReviewFile(repoRoot, file);
    const anchor = sourceAnchor(report, file);
    if ((report.source_snapshot || report.source_anchors) && !anchor)
      return undefined;
    if (anchor && sourceHash(text) !== anchor.sha256) return undefined;
    return text;
  } catch {
    return undefined;
  }
}

export function liveBlocks(
  report: AnalysisReport,
  repoRoot: string,
  blocks: CommentBlock[],
  editorText?: (file: string) => string | undefined,
): CommentBlock[] {
  const lines = new Map<string, string[] | undefined>();
  return blocks.filter((block) => {
    if (!lines.has(block.file))
      lines.set(
        block.file,
        liveSource(
          repoRoot,
          report,
          block.file,
          editorText?.(block.file),
        )?.split(/\r?\n/),
      );
    const text = lines.get(block.file);
    if (!text || !validLine(block.line, text.length) || block.line === 0)
      return false;
    return (
      block.col === undefined ||
      (Number.isSafeInteger(block.col) &&
        block.col >= 1 &&
        block.col <= text[block.line - 1].length + 1)
    );
  });
}
