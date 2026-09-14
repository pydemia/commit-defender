import assert from "node:assert/strict";
import test from "node:test";
import { summarizeLocalReviews } from "@gcr/client-core";
import {
  LocalReviewActivity,
  localReviewActivityHtml,
  type LocalActivityHistory,
} from "../src/localReviewActivity.js";
import { ui } from "./helpers/vscode-central.js";
const data: LocalActivityHistory = {
  scope: {
    kind: "repository",
    profileId: "activity-test",
    repositoryKey: "a".repeat(64),
    worktreeKey: "b".repeat(64),
  },
  repository: "/repo",
  reports: [],
  incompleteHistory: false,
};
test("escapes repository/model text and reports partial history and unknown costs explicitly", () => {
  const summary = summarizeLocalReviews([], {
    scope: data.scope,
    days: 30,
    incompleteHistory: true,
  });
  summary.models = [
    {
      executor: "<script>alert(1)</script>",
      model: "<img src=x onerror=alert(1)>",
      reviews: 1,
    },
  ];
  const html = localReviewActivityHtml(
    summary,
    "<profile>",
    "/repo/<img src=x>",
  );
  assert(!html.includes("<script>"));
  assert(!html.includes("<img"));
  assert(html.includes("&lt;profile&gt;"));
  assert(html.includes("local history is unavailable"));
  assert(html.includes("Unknown — not recorded"));
  assert(html.includes("not unique confirmed defects"));
  assert(html.includes("default-src 'none'"));
});
test("cancelled period selection and invalid arguments never read history", async () => {
  ui.reset();
  ui.choices = ["cancel"];
  let reads = 0;
  const view = new LocalReviewActivity(async () => {
    reads++;
    return data;
  });
  await view.show();
  await view.show("7");
  assert.equal(reads, 0);
  assert.equal(ui.panels.length, 0);
  view.dispose();
});
test("refresh replaces the previous view and invalidation closes it", async () => {
  ui.reset();
  let reads = 0;
  const view = new LocalReviewActivity(async () => {
    reads++;
    return data;
  });
  await view.show(7);
  await view.show(90);
  assert.equal(reads, 2);
  assert.equal(ui.panels.length, 2);
  assert(ui.panels[0]!.disposed);
  assert(ui.html[1]!.includes("last 90 days"));
  view.dispose();
  assert(ui.panels[1]!.disposed);
});
test("an old async read cannot reopen a view after scope invalidation or a newer read", async () => {
  ui.reset();
  let release!: (value: LocalActivityHistory) => void;
  const pending = new Promise<LocalActivityHistory>((resolve) => {
    release = resolve;
  });
  let first = true;
  const view = new LocalReviewActivity(() => {
    if (first) {
      first = false;
      return pending;
    }
    return Promise.resolve(data);
  });
  const load = view.show(7);
  await view.show(30);
  release(data);
  await load;
  assert.equal(ui.panels.length, 1);
  assert(ui.html[0]!.includes("last 30 days"));
  view.dispose();
  ui.reset();
  let finish!: (value: LocalActivityHistory) => void;
  const delayed = new LocalReviewActivity(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const stale = delayed.show(7);
  delayed.dispose();
  finish(data);
  await stale;
  assert.equal(ui.panels.length, 0);
});
test("failed authorized history reads clear a previous view and never expose error details", async () => {
  ui.reset();
  let fail = false;
  const view = new LocalReviewActivity(async () => {
    if (fail) throw Error("secret-canary");
    return data;
  });
  await view.show(30);
  fail = true;
  await view.show(30);
  assert(ui.panels[0]!.disposed);
  assert.equal(ui.errors.length, 1);
  assert(!ui.errors[0]!.includes("secret-canary"));
  view.dispose();
});
