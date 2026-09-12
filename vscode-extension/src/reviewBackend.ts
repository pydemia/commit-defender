import { createHash } from "crypto";
import { Reviewer, type ProgressCb } from "./ai/reviewer.js";
import type { ResolvedConfig } from "./config.js";
import { truncate } from "./diff.js";
import { captureStagedSnapshot, type StagedSnapshot } from "./gitSnapshot.js";
import { captureWorkingFiles, type CapturedFiles } from "./reviewInput.js";
import { sourceHash } from "./reviewSource.js";
import type { SourceExclusion } from "./sourcePolicy.js";
import { loadSkillMaterial } from "./skills.js";
import type { CommitMessageResult, RunResult } from "./types.js";

export type ReviewScope = "staged" | "file" | "directory" | "repository";
export interface ReviewRequest {
  repoRoot: string;
  files: string[];
  scope: ReviewScope;
  scopeTarget?: string;
  sourceExclusions?: SourceExclusion[];
}
export interface PreparedExecution<T> {
  readonly backendId: string;
  readonly key: string;
  run(signal: AbortSignal, progress?: ProgressCb): Promise<T>;
}
export interface ReviewBackend {
  prepareReview(request: ReviewRequest): PreparedExecution<RunResult>;
  prepareCommitMessage(
    repoRoot: string,
  ): PreparedExecution<CommitMessageResult>;
}

/** One selection point. Future backends replace this adapter; a request never fans out to both. */
export function createReviewBackend(config: ResolvedConfig): ReviewBackend {
  return new LegacyReviewBackend(config);
}

class LegacyReviewBackend implements ReviewBackend {
  private readonly config: ResolvedConfig;
  constructor(config: ResolvedConfig) {
    this.config = { ...config, excludePatterns: [...config.excludePatterns] };
  }
  private key(operation: string, source: unknown): string {
    // Keep credentials and source material out of identifiers and logs.
    return createHash("sha256")
      .update(
        JSON.stringify({
          backend: "legacy",
          operation,
          config: this.config,
          source,
        }),
      )
      .digest("hex");
  }
  prepareReview(input: ReviewRequest): PreparedExecution<RunResult> {
    const request = {
      ...input,
      files: [...input.files],
      sourceExclusions: input.sourceExclusions?.map((entry) => ({ ...entry })),
    };
    let captured: StagedSnapshot | CapturedFiles | Error;
    let material: ReturnType<typeof loadSkillMaterial> = {
      text: "",
      truncated: false,
    };
    try {
      captured =
        request.scope === "staged"
          ? captureStagedSnapshot(request.repoRoot, this.config.excludePatterns)
          : captureWorkingFiles(
              request.repoRoot,
              request.files,
              this.config.excludePatterns,
            );
      material = loadSkillMaterial(
        request.repoRoot,
        this.config.excludePatterns,
      );
    } catch (error) {
      captured = error instanceof Error ? error : new Error(String(error));
    }
    const identity =
      captured instanceof Error
        ? { error: captured.message }
        : "sourceTree" in captured
          ? {
              baseCommit: captured.baseCommit,
              base: captured.baseTree,
              source: captured.sourceTree,
              files: captured.files,
              excluded: captured.excluded,
            }
          : {
              files: captured.files,
              excluded: captured.exclusions,
              sources: [...captured.sources].map(([file, text]) => [
                file,
                sourceHash(text),
              ]),
              errors: [...captured.readErrors].map(([file, error]) => [
                file,
                error.message,
              ]),
            };
    const reviewer = new Reviewer(this.config, material);
    return {
      backendId: "legacy",
      key: this.key("review", { request, identity, material }),
      run: (signal, progress) =>
        request.scope === "staged"
          ? reviewer.reviewDiff(
              request.repoRoot,
              request.files,
              signal,
              captured as StagedSnapshot | Error,
            )
          : reviewer.reviewFilesSeparately(
              request.repoRoot,
              request.files,
              signal,
              progress,
              captured as CapturedFiles | Error,
            ),
    };
  }
  prepareCommitMessage(
    repoRoot: string,
  ): PreparedExecution<CommitMessageResult> {
    let captured: string | Error;
    let identity: unknown;
    try {
      const snapshot = captureStagedSnapshot(
        repoRoot,
        this.config.excludePatterns,
      );
      if (snapshot.excluded.length)
        throw new Error(
          `Commit message was not generated: ${snapshot.excluded.length} staged path(s) are excluded by source policy.`,
        );
      captured = truncate(snapshot.diff()).trim();
      identity = {
        baseCommit: snapshot.baseCommit,
        base: snapshot.baseTree,
        source: snapshot.sourceTree,
      };
    } catch (error) {
      captured = error instanceof Error ? error : new Error(String(error));
    }
    const reviewer = new Reviewer(this.config);
    return {
      backendId: "legacy",
      key: this.key("commit-message", {
        repoRoot,
        identity,
        captured:
          captured instanceof Error ? { error: captured.message } : captured,
      }),
      run: (signal) =>
        reviewer.generateCommitMessage(repoRoot, signal, captured),
    };
  }
}
