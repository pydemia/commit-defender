/** Local reconstruction from recorded G02/G04 metadata, never a PRISM export. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { contentHash } from "@gcr/client-core";
import { centralMemoryContent, reviewHistoryGuidance,
  reviewHistoryMessage } from "@gcr/client-contract";

export function w02HistoryFixture(records: string) {
  const load = (name: string) => JSON.parse(fs.readFileSync(
    path.join(records, name), "utf8"));
  const draft = load("G02-guidance-draft.json");
  const state = load("G04-guidance-state.json");
  const comparison = load("G02-source-comparison.json");
  assert.equal(draft.guidanceId, state.id);
  assert.equal(draft.source.contentHash, state.source.contentHash);
  const content = centralMemoryContent(draft.content);
  const repositoryId = randomUUID();
  const timestamp = new Date().toISOString();
  const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
  const body = "[W02 LOCAL RECONSTRUCTION; NOT ORIGINAL COMMENT]\n" +
    content.detail + "\n" + content.recommendation;
  const source = reviewHistoryMessage({
    id: state.source.id,
    pullRequestId: comparison.pulls.find((p: any) => p.number === 917)
      .coverage.pull_request_id,
    observationHash: contentHash({ local: true, body }),
    kind: "review-comment", authorLogin: "w02-fixture", authorType: "User",
    contentHash: sha256(body), path: content.appliesTo.filePaths[0],
    line: 1, side: "RIGHT", commitSha: null, inReplyToGithubId: null,
    htmlUrl: state.source.htmlUrl, githubCreatedAt: timestamp,
    githubUpdatedAt: timestamp, githubId: "3967869279",
    upstreamState: "present", parentId: null, reviewSourceId: null,
    replyCount: 1, lastObservedAt: timestamp, body, provenance: null,
  });
  assert.notEqual(source.contentHash, state.source.contentHash);
  const replyRecord = comparison.pulls.find((p: any) => p.number === 917)
    .matches.find((item: any) => item.replyTo === source.githubId);
  const replyBody = "[W02 LOCAL RECONSTRUCTION; NOT ORIGINAL REPLY]\n" +
    "수정 여부는 현재 source/base와 호출 경로에서 확인한다.";
  const reply = reviewHistoryMessage({ ...source, id: replyRecord.sourceId,
    githubId: replyRecord.githubId, parentId: source.id, replyCount: 0,
    inReplyToGithubId: source.githubId, body: replyBody,
    contentHash: sha256(replyBody), observationHash: contentHash(replyBody),
    htmlUrl: "https://example.invalid/w02/local-reply",
  });
  const guidance = reviewHistoryGuidance({
    schemaVersion: 1, repositoryId, id: state.id, revision: state.revision,
    state: state.state, needsReview: state.needsReview,
    publicationRequested: state.publicationRequested, content,
    source: { id: source.id, pullNumber: 917, htmlUrl: source.htmlUrl,
      contentHash: source.contentHash, observationHash: source.observationHash,
      upstreamState: "present" }, createdAt: timestamp, reviewedAt: timestamp,
  });
  const revision = contentHash({ source, reply, guidance });
  const common = { schemaVersion: 1, repositoryId, revision };
  const pull = (number: number) => ({
    id: comparison.pulls.find((p: any) => p.number === number)
      .coverage.pull_request_id,
    number, title: `W02 local reconstruction #${number}`, state: "open",
    htmlUrl: `https://github.com/skccmygit/skax-successionX-backend/pull/${number}`,
    messageCount: number === 917 ? 2 : 0, replyCount: number === 917 ? 1 : 0,
    notReturnedCount: 0, coverage: { state: number === 917 ? "collected" : "uncollected",
      lastCompleteAt: number === 917 ? timestamp : null, syncStartedAt: null,
      observedCount: number === 917 ? 2 : null, errorCode: null },
  });
  const excerpt = ({ body, provenance: _provenance, ...item }: typeof source) =>
    ({ ...item, excerpt: body.slice(0, 500), bodyCharacters: body.length });
  const respond = (url: string) => {
    const request = new URL(url, "https://fixture.invalid");
    const route = request.pathname.split("/review-history")[1];
    if (!route) return { ...common, items: [pull(Number(
      request.searchParams.get("pullNumber")))], nextCursor: null,
      capabilities: { manage: false } };
    if (route === `/guidance/${guidance.id}`) return guidance;
    if (route === "/guidance") return { ...common, items: [guidance], nextCursor: null };
    if (route === `/pulls/917/messages/${source.id}/versions`) return {
      ...common, sourceId: source.id, nextCursor: null, items: [{
        id: source.id, body: source.body, contentHash: source.contentHash,
        path: source.path, line: source.line, side: source.side,
        commitSha: null, githubUpdatedAt: timestamp, observedAt: timestamp,
      }],
    };
    if (route === `/pulls/917/messages/${source.id}/history`) return {
      ...common, sourceId: source.id, nextCursor: null, items: [{ id: "1",
        observationHash: source.observationHash, observedAt: timestamp,
        syncStartedAt: timestamp, snapshot: source }],
    };
    for (const item of [source, reply])
      if (route === `/pulls/917/messages/${item.id}`)
        return { ...common, pullNumber: 917, item };
    if (route === "/pulls/917/messages") return { ...common, pull: pull(917),
      items: (request.searchParams.has("parentId") ? [reply] : [source, reply])
        .map(excerpt), nextCursor: null };
    if (route === "/pulls/915/messages") return { ...common,
      pull: pull(915), items: [], nextCursor: null };
    throw Error("Unexpected local fixture reader route");
  };
  return { repositoryId, respond, source, reply, guidance, revision,
    historicalHash: state.source.contentHash,
    memories: [{ id: guidance.id, revision: guidance.revision,
      aggregationKey: contentHash({ localGuidance: guidance.id }),
      contentHash: contentHash(content), sourceRevision: guidance.revision,
      sourceContentHash: source.contentHash, kind: "decision" as const,
      content, sources: [{ kind: "github-pr-message" as const, id: source.id,
        contentHash: source.contentHash }], sourceBaseSha: null,
      sourceHeadSha: null, supersedesId: null }],
  };
}
