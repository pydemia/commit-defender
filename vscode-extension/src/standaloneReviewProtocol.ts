import type { OfflineBehavior } from "@gcr/client-contract";
import type { ModelCredentialReference } from "./modelCredentials.js";

/** Supplied by the extension's user settings and command handler, never a repository file. */
export interface StandaloneReviewSettings {
  mode: string;
  /** Explicit extension-owned selection, scoped to the local profile and worktree. */
  connectionId?: string;
  centralSources?: import("./centralConnection.js").CentralSource[];
  freshness?: "online" | "offline";
  offlineBehavior?: OfflineBehavior;
  /** Host-pinned snapshot after explicit feedback synchronization. */
  requiredCentralSnapshot?: string;
  profileId: string;
  provider: string;
  model: string;
  reasoningEffort: string;
  executablePath: string;
  workspaceTrusted: boolean;
  durationMs: number;
  excludePatterns: string[];
  endpoint?: string;
  apiVersion?: string;
  maxTokens?: number;
  modelCredentialRef?: ModelCredentialReference;
}

export class StandaloneReviewError extends Error {
  constructor(
    readonly code: string,
    readonly retryAt?: number,
  ) {
    super(standaloneErrorMessage(code));
    this.name = "StandaloneReviewError";
  }
}

/** Only these generic diagnostics may cross the worker boundary; never raw provider output. */
export function standaloneErrorMessage(code: string): string {
  switch (code) {
    case "source-changed":
      return "The saved or staged source changed before automatic review could start.";
    case "request-interrupted":
      return "A previous process may have started this review. Check its outcome before another execution.";
    case "request-busy":
    case "request-deferred":
      return "The shared review request is busy or waiting for manual review priority or its review budget.";
    case "request-lost":
      return "This process no longer owns the review request.";
    case "request-invalid":
      return "The saved request, source or authorization changed. Refresh before reviewing.";
    case "cancelled":
      return "Review preparation was cancelled.";
    case "timeout":
      return "Review preparation exceeded its time limit.";
    case "untrusted-workspace":
      return "Trust this workspace before starting a local review.";
    case "unsupported-mode":
      return "Select standalone or an explicitly connected centralized review.";
    case "central-connection-required":
      return "Choose a central connection for this profile and worktree, or explicitly select standalone review.";
    case "authentication-required":
    case "revoked":
    case "disabled":
      return "The central connection is expired, disconnected or revoked. Reconnect before using its knowledge.";
    case "identity-unavailable":
      return "The central server could not verify your identity. Cached knowledge is paused until an authenticated synchronization succeeds.";
    case "unavailable":
      return "The central service is unavailable. Retry, or explicitly select signed offline knowledge if its lease is valid.";
    case "busy":
    case "superseded":
      return "The central connection is being updated. Refresh its status and retry.";
    case "invalid-binding":
    case "invalid-manifest":
    case "invalid-bundle":
    case "incompatible":
    case "cache-unavailable":
      return "Central knowledge could not be verified. Check the selected server, signing keys, compatibility and cache expiry.";
    case "repository-mismatch":
      return "Git remotes no longer match the selected central repository. Check this worktree's remotes and reconnect before using central knowledge.";
    case "unsupported-reasoning":
      return "This provider does not expose the selected reasoning effort. Choose a supported effort or its default.";
    case "model-failed":
      return "The selected local model did not complete this review. No fallback provider was used.";
    case "unsupported-provider":
      return "This provider does not yet support fixed-source standalone review. Your account settings have been preserved.";
    case "account-not-configured":
      return "Select an account provider and model in user settings before starting a standalone review. Repository account settings are not used for local execution.";
    case "executor-unavailable":
      return "The selected local executor is unavailable. Check the selected CLI executable, supported version, model and reasoning effort. Claude Code needs safe mode; Antigravity needs the agent CLI with no-tools agents.";
    case "credential-unavailable":
      return "The OS credential store is unavailable. Encrypted local history and knowledge could not be opened.";
    case "insecure-storage":
      return "The local data path has unsafe permissions or a filesystem link. Existing files were preserved; choose a private local data location.";
    case "storage-unavailable":
      return "The local storage helper or filesystem is unavailable. Check the installed extension and local disk access.";
    case "unsupported-platform":
      return "This execution environment or storage volume is unsupported. Windows manual review requires a local NTFS checkout.";
    case "corrupt-storage":
      return "Encrypted local data failed integrity verification. Existing data was preserved.";
    case "commit-unknown":
      return "Local publication could not be confirmed. Reopen saved history before retrying.";
    case "needs-context":
      return "Required review context is unavailable. No model request was made.";
    case "central-snapshot-changed":
      return "Central policy changed after synchronization. Refresh the feedback status and synchronize again before reviewing.";
    case "policy-unavailable":
      return "The local execution policy could not authorize this review.";
    case "no-source":
      return "No reviewable source was captured for the selected paths.";
    case "disposed":
      return "The prepared review has already been released.";
    default:
      return "Local review preparation failed. No fallback provider was used.";
  }
}

const safeCodes = new Set([
  "source-changed",
  "request-interrupted",
  "request-busy",
  "request-deferred",
  "request-lost",
  "request-invalid",
  "central-connection-required",
  "authentication-required",
  "revoked",
  "disabled",
  "unavailable",
  "identity-unavailable",
  "busy",
  "superseded",
  "invalid-binding",
  "repository-mismatch",
  "invalid-manifest",
  "invalid-bundle",
  "incompatible",
  "cache-unavailable",
  "cancelled",
  "timeout",
  "untrusted-workspace",
  "unsupported-mode",
  "unsupported-provider",
  "unsupported-reasoning",
  "model-failed",
  "executor-unavailable",
  "credential-unavailable",
  "insecure-storage",
  "storage-unavailable",
  "unsupported-platform",
  "corrupt-storage",
  "commit-unknown",
  "needs-context",
  "central-snapshot-changed",
  "policy-unavailable",
  "no-source",
  "disposed",
  "account-not-configured",
]);
export function standaloneError(error: unknown): StandaloneReviewError {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  return new StandaloneReviewError(
    typeof code === "string" && safeCodes.has(code)
      ? code
      : "preparation-failed",
    code === "request-deferred" &&
      error &&
      typeof error === "object" &&
      "retryAt" in error &&
      typeof error.retryAt === "number" &&
      Number.isSafeInteger(error.retryAt)
      ? error.retryAt
      : undefined,
  );
}
