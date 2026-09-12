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
import { prepareStandaloneWorker } from "./standaloneWorkerClient.js";
import type { StandaloneReviewSettings } from "./standaloneReviewProtocol.js";

export type ReviewScope =
  "staged" | "file" | "directory" | "repository" | "selection";
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
  /** Releases an unused snapshot/worker, including a duplicate preparation. */
  dispose?(): void | Promise<void>;
}
export interface ReviewBackend {
  prepareReview(
    request: ReviewRequest,
    signal: AbortSignal,
  ): Promise<PreparedExecution<RunResult>>;
  prepareCommitMessage(
    repoRoot: string,
  ): PreparedExecution<CommitMessageResult>;
}

/** Manual reviews always use the shared fixed-source core. Account adapters remain for commit messages. */
export function createReviewBackend(
  config: ResolvedConfig,
  local: { workerFile: string; settings: StandaloneReviewSettings },
): ReviewBackend {
  const settings = structuredClone(local.settings);
  const commitMessages = createLegacyReviewBackend(config);
  return {
    prepareReview: (request, signal) =>
      prepareStandaloneWorker(local.workerFile, request, settings, signal),
    prepareCommitMessage: (repoRoot) =>
      commitMessages.prepareCommitMessage(repoRoot),
  };
}

/** Retained for commit-message generation and historical provider regression tests. */
export function createLegacyReviewBackend(
  config: ResolvedConfig,
): LegacyReviewBackend {
  return new LegacyReviewBackend(config);
}

class LegacyReviewBackend {
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
