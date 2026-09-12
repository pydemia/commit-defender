import {
  projectCommitDefender,
  type ClientReviewReport,
  type LocalScope,
} from "@gcr/client-contract";
import type { HistoryEntry, AnalysisScope } from "./historyProvider.js";
import { OUTCOME_META, reviewStatus } from "./reviewOutcome.js";

/** A reload can race a completed review. Retain matching in-memory entries and reject other namespaces. */
export function mergeLocalHistory(
  current: readonly HistoryEntry[],
  reports: readonly ClientReviewReport[],
  repoRoot: string,
  scope: Extract<LocalScope, { kind: "repository" }>,
): HistoryEntry[] {
  const belongs = (report: ClientReviewReport) => {
    const client = report.identity.client;
    return (
      client.mode === "standalone" &&
      client.profileId === scope.profileId &&
      client.repositoryKey === scope.repositoryKey &&
      client.worktreeKey === scope.worktreeKey
    );
  };
  const merged = new Map<string, HistoryEntry>();
  for (const core of reports) {
    if (!belongs(core) || !core.finishedAt) continue;
    const report = projectCommitDefender(core);
    merged.set(core.runId, {
      id: core.runId,
      timestamp: new Date(core.finishedAt),
      report,
      repoRoot,
      label: `${OUTCOME_META[reviewStatus(report.review)].label} · ${report.staged_files.length} file(s)`,
      scope: (core.identity.source.kind === "index"
        ? "staged"
        : "selection") as AnalysisScope,
    });
  }
  for (const entry of current) {
    if (entry.report.gcr && belongs(entry.report.gcr.report))
      merged.set(entry.id, { ...entry, repoRoot });
  }
  return [...merged.values()]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 20);
}
