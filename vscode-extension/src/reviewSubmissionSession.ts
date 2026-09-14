import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  clientReviewReport,
  type ClientReviewReport,
} from "@gcr/client-contract";
import {
  CentralConnections,
  LocalRecordStore,
  LocalHistoryStore,
  ReviewSubmissionQueue,
  prepareReviewSubmission,
  contentHash,
  defaultLocalDataDirectory,
} from "@gcr/client-core";
import { knowledgeScope, withLocalKnowledge } from "./localKnowledge.js";
import type { CentralPorts } from "./centralConnection.js";

export type SubmissionSelection = Parameters<
  typeof prepareReviewSubmission
>[0]["selection"];
export type SubmissionEntry = Awaited<
  ReturnType<ReviewSubmissionQueue["get"]>
>["value"];
export type SubmissionPreview = ReturnType<typeof prepareReviewSubmission>;
export class SubmissionSessionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const fail = (code: string): never => {
  throw new SubmissionSessionError(code);
};
type Options = {
  repoRoot: string;
  profileId: string;
  connectionId: string;
  report: unknown;
  /** Host-owned workspace trust and selection check; never supplied by a webview. */
  current: () => boolean;
  ports?: CentralPorts;
};

/** An explicit submission session has no executor, timer, or automatic upload. */
export class ReviewSubmissionSession {
  private preview?: SubmissionPreview;
  private closed = false;
  private busy = false;
  private readonly localCandidates = new Map<string, string>();
  private constructor(
    private readonly options: Options,
    readonly report: ClientReviewReport,
    private readonly connections: CentralConnections,
    private readonly queue: ReviewSubmissionQueue,
    private readonly binding: string,
    readonly destination: {
      serverUrl: string;
      audience: SubmissionPreview["submission"]["audience"];
    },
  ) {}
  static async open(options: Options) {
    if (!options.current()) fail("selection-changed");
    const report = clientReviewReport(options.report);
    const scope = knowledgeScope({ ...options, scope: "repository" });
    const client = report.identity.client;
    if (
      scope.kind !== "repository" ||
      client.profileId !== scope.profileId ||
      client.repositoryKey !== scope.repositoryKey ||
      client.worktreeKey !== scope.worktreeKey
    )
      fail("report-mismatch");
    const connections = await CentralConnections.open({
      scope,
      ...options.ports,
    });
    let queue: ReviewSubmissionQueue | undefined;
    try {
      const identity = await connections.historyIdentity(options.connectionId);
      const status = await connections.status(options.connectionId);
      if (
        status.status !== "connected" ||
        status.clientId !== "commit-defender"
      )
        fail("selection-changed");
      if (
        client.mode === "centralized" &&
        (contentHash(client.audience) !== contentHash(identity.audience) ||
          client.execution?.connectionId !== options.connectionId)
      )
        fail("report-mismatch");
      if (
        client.mode === "standalone" &&
        client.execution?.configuredMode === "centralized" &&
        client.execution.connectionId !== options.connectionId
      )
        fail("report-mismatch");
      const directory =
        options.ports?.dataDirectory ?? defaultLocalDataDirectory();
      const records = await LocalRecordStore.open({
        scope,
        ...options.ports,
        dataDirectory:
          client.mode === "centralized"
            ? path.join(
                directory,
                "central-review-history",
                options.connectionId,
              )
            : directory,
      });
      try {
        const stored = await new LocalHistoryStore(
          records,
          undefined,
          client.mode === "centralized" ? identity.audience : undefined,
        ).getReview(report.runId);
        if (!stored || contentHash(stored) !== contentHash(report))
          fail("report-mismatch");
      } finally {
        records.close();
      }
      queue = await ReviewSubmissionQueue.open({
        scope,
        ...options.ports,
        connectionId: options.connectionId,
        connections,
      });
      const session = new ReviewSubmissionSession(
        options,
        report,
        connections,
        queue,
        connectionBinding(status),
        { serverUrl: status.serverUrl, audience: identity.audience },
      );
      await session.authorize();
      return session;
    } catch (error) {
      queue?.close();
      connections.close();
      throw error;
    }
  }
  close() {
    this.closed = true;
    this.queue.close();
    this.connections.close();
  }
  private async authorize() {
    if (this.closed || !this.options.current()) fail("selection-changed");
    await this.connections.historyIdentity(this.options.connectionId);
    const status = await this.connections.status(this.options.connectionId);
    if (
      this.closed ||
      !this.options.current() ||
      connectionBinding(status) !== this.binding
    )
      fail("selection-changed");
  }
  private async operation<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) fail("busy");
    this.busy = true;
    try {
      await this.authorize();
      const result = await work();
      await this.authorize();
      return result;
    } finally {
      this.busy = false;
    }
  }
  private belongs(entry: SubmissionEntry) {
    if (
      entry.payload.review.runId !== this.report.runId ||
      entry.payload.review.sourceHash !== this.report.identity.source.hash ||
      entry.payload.review.contextHash !== this.report.identity.context.hash
    )
      fail("report-mismatch");
    return entry;
  }
  private confirmed(hash: string) {
    if (!this.preview || this.preview.payloadHash !== hash)
      return fail("confirmation-required");
    return this.preview;
  }
  prepare(selection: SubmissionSelection) {
    return this.operation(async () => {
      this.preview = prepareReviewSubmission({
        report: this.report,
        id: randomUUID(),
        audience: this.destination.audience,
        clientId: "commit-defender",
        approvedAt: new Date().toISOString(),
        selection,
      });
      return structuredClone(this.preview);
    });
  }
  list() {
    return this.operation(async () =>
      (await this.queue.list())
        .map((row) => row.value)
        .filter((row) => row.payload.review.runId === this.report.runId)
        .map((row) => this.belongs(row)),
    );
  }
  select(id: string) {
    return this.operation(async () => {
      const entry = this.belongs((await this.queue.get(id)).value);
      this.preview = {
        submission: entry.payload,
        payloadHash: entry.payloadHash,
      };
      return structuredClone(this.preview);
    });
  }
  save(hash: string) {
    return this.operation(async () => {
      const preview = this.confirmed(hash);
      return (await this.queue.enqueue(preview.submission, hash)).value;
    });
  }
  send(hash: string, signal: AbortSignal) {
    return this.operation(async () => {
      const preview = this.confirmed(hash);
      if (signal.aborted) fail("cancelled");
      const entry = await this.queue.enqueue(preview.submission, hash);
      await this.authorize();
      // This call is reachable only from a newly confirmed Send action, including retries.
      return (await this.queue.send(entry.value.payload.id, signal, true))
        .value;
    });
  }
  cancel(id: string) {
    return this.operation(async () => {
      this.belongs((await this.queue.get(id)).value);
      return (await this.queue.cancel(id)).value;
    });
  }
  saveLocalCandidate(hash: string) {
    return this.operation(async () => {
      const { submission } = this.confirmed(hash);
      if (submission.kind !== "feedback") return fail("feedback-required");
      const previous = this.localCandidates.get(submission.id);
      if (previous) return { id: previous };
      const scope = knowledgeScope({ ...this.options, scope: "repository" });
      const memory = await withLocalKnowledge(
        scope,
        (store) =>
          store.create({
            kind: "memory",
            title: submission.feedback.message.trim().slice(0, 120),
            body: submission.feedback.message,
            rationale: "User feedback on a saved review; pending local review.",
            counterEvidence: [],
            appliesTo: { paths: [], languages: [], symbols: [], branches: [] },
            sources: [{ kind: "user-note", id: submission.id }],
          }),
        this.options.ports,
      );
      this.localCandidates.set(submission.id, memory.id);
      return { id: memory.id };
    });
  }
}
function connectionBinding(
  status: Awaited<ReturnType<CentralConnections["status"]>>,
) {
  const { cache: _cache, ...binding } = status;
  return contentHash(binding);
}
