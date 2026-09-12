/** Supplied by the extension's user settings and command handler, never a repository file. */
export interface StandaloneReviewSettings {
  mode: string;
  profileId: string;
  provider: string;
  model: string;
  reasoningEffort: string;
  executablePath: string;
  workspaceTrusted: boolean;
  durationMs: number;
  excludePatterns: string[];
}

export class StandaloneReviewError extends Error {
  constructor(readonly code: string) {
    super(standaloneErrorMessage(code));
    this.name = "StandaloneReviewError";
  }
}

/** Only these generic diagnostics may cross the worker boundary; never raw provider output. */
export function standaloneErrorMessage(code: string): string {
  switch (code) {
    case "cancelled":
      return "Review preparation was cancelled.";
    case "timeout":
      return "Review preparation exceeded its time limit.";
    case "untrusted-workspace":
      return "Trust this workspace before starting a local review.";
    case "unsupported-mode":
      return "Centralized review is not available in this build. Select standalone mode.";
    case "unsupported-provider":
      return "This provider does not yet support fixed-source standalone review. Your account settings have been preserved.";
    case "account-not-configured":
      return "Select an account provider and model in user settings before starting a standalone review. Repository account settings are not used for local execution.";
    case "executor-unavailable":
      return "The selected local executor is unavailable. Check the Codex executable, model and reasoning effort.";
    case "credential-unavailable":
      return "The OS credential store is unavailable. Encrypted local history and knowledge could not be opened.";
    case "needs-context":
      return "Required review context is unavailable. No model request was made.";
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
  "cancelled",
  "timeout",
  "untrusted-workspace",
  "unsupported-mode",
  "unsupported-provider",
  "executor-unavailable",
  "credential-unavailable",
  "needs-context",
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
  );
}
