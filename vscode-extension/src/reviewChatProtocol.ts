import type {
  LocalReviewConversation,
  ClientReviewReport,
} from "@gcr/client-contract";
export interface ReviewChatTarget {
  repoRoot: string;
  reportId: string;
  mode: "standalone" | "centralized";
}
export type ReviewChatAction =
  | { type: "read" }
  | { type: "send"; turnId: string; content: string }
  | { type: "answer"; turnId: string; questionId: string; content: string }
  | { type: "resume"; turnId: string }
  | { type: "cancel"; turnId: string }
  | { type: "source"; turnId: string; citation: number };
export interface ReviewChatState {
  conversation: LocalReviewConversation;
  review: ClientReviewReport;
}
export type ReviewChatResult =
  | { type: "state"; state: ReviewChatState }
  | {
      type: "source";
      content: string;
      path: string;
      side: "source" | "base";
      line: number;
    };
export class ReviewChatError extends Error {
  constructor(readonly code: string) {
    super(reviewChatErrorMessage(code));
  }
}
export function reviewChatErrorMessage(code: string): string {
  switch (code) {
    case "missing":
      return "This review has no saved conversation source. Run a new review to start a source-linked conversation.";
    case "stale-identity":
      return "The review context, model, source exclusions, or budget has changed. Run a new review to discuss the current settings.";
    case "audience-mismatch":
    case "selection-changed":
      return "The selected profile, repository, or central connection has changed. Reopen the conversation from the selected review history.";
    case "invalid-state":
    case "revision-conflict":
      return "The conversation changed in another window or is waiting for an answer. Refresh its saved state.";
    case "quota-exceeded":
      return "This turn has exhausted its review budget. Cancel the pending turn before starting a new question.";
    case "expired":
      return "This question has expired. Start a new question.";
    case "cancelled":
      return "Conversation execution was cancelled.";
    case "policy-unavailable":
      return "The current workspace, model, or central context does not authorize this conversation. Check the current review settings.";
    default:
      return "The conversation could not be opened or completed. Check the OS credential store and current review connection, then refresh.";
  }
}
export function chatError(error: unknown): ReviewChatError {
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "unavailable";
  return new ReviewChatError(code);
}
