import type { SubmissionFollowup } from "./reviewSubmissionSession.js";

export function submissionFollowupSummary(value: SubmissionFollowup) {
  const d = value.status.decision,
    rule = d?.rule,
    feedback = d?.feedback;
  const states = {
    draft: "Draft",
    evaluated: "Evaluated",
    shadow: "Shadow",
    active: "Active",
    retired: "Retired",
  };
  let state = !d
    ? "Received; awaiting central review."
    : d.action === "dismiss"
      ? "Closed without a criterion change."
      : `${states[rule!.state]} criterion · revision ${rule!.revision}.`;
  if (feedback) {
    state += !feedback.resolution
      ? " Feedback awaits a central decision."
      : feedback.resolution.action === "reject"
        ? " Feedback was rejected."
        : feedback.resolution.action === "acknowledge"
          ? " Correction acknowledged; acknowledgement does not change the criterion."
          : " Exception approved for its recorded scope and revision.";
    if (feedback.exception) {
      const e = feedback.exception;
      state += e.revoked
        ? " The exception has been revoked."
        : Date.parse(e.expiresAt) <= Date.now()
          ? " The exception has expired."
          : ` Exception period: ${e.startsAt} to ${e.expiresAt}.`;
      if (e.revision !== rule!.revision)
        state += " It belongs to an older criterion revision.";
    }
  }
  const syncLabels = {
    "no-adoption": "No adopted criterion to synchronize.",
    "not-active":
      "The criterion is not active; it is not an active review policy.",
    "pending-feedback": "The feedback still needs a central decision.",
    "feedback-rejected":
      "The feedback was rejected; no approved change is implied.",
    "acknowledged-only":
      "Acknowledgement has not produced a newer criterion revision.",
    "outdated-exception":
      "The approved exception belongs to an older criterion revision.",
    "exception-inactive":
      "The exception is revoked, expired, or has not started.",
    "awaiting-publication":
      "Synchronization finished, but the reviewed revision or exception is not in the signed policy yet. Try synchronizing after publication completes.",
    "criterion-current":
      "The current criterion revision is present in the synchronized signed policy. Its source scope still determines where it applies.",
    "exception-current":
      "The approved exception and current criterion revision are present in the synchronized signed policy. The exception applies only within its scope and period.",
  };
  return {
    id: value.id,
    title: rule?.title ?? "Submission review",
    state,
    note: [d?.note, feedback?.resolution?.note].filter(Boolean).join("\n"),
    checkedAt: value.status.checkedAt,
    sync: value.sync
      ? syncLabels[value.sync.policyState]
      : "Synchronize to check whether the reviewed change is available locally.",
    rereviewAllowed:
      !!value.sync &&
      ["criterion-current", "exception-current"].includes(
        value.sync.policyState,
      ),
  };
}
