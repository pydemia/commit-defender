import assert from "node:assert/strict";
import test from "node:test";
import { getStandaloneReviewSettings, getConfig } from "../src/config.js";
import { values, workspace } from "./helpers/vscode-config.js";

test("runtime config never reads legacy plaintext keys and accepts model references only from user settings", () => {
  const ref = { version: 1, profileId: "test", id: "a".repeat(64) };
  values.global = { apiKey: "synthetic-user-key", modelCredentialRef: ref };
  values.repository = { apiKey: "synthetic-workspace-key", modelCredentialRef: { ...ref, id: "b".repeat(64) } };
  values.reads = [];
  const cfg = getConfig();
  assert.equal(cfg.apiKey, "");
  assert.deepEqual(cfg.modelCredentialRef, ref);
  assert(!values.reads.includes("apiKey"));
  assert.equal(values.global.apiKey, "synthetic-user-key");
  assert.equal(values.repository.apiKey, "synthetic-workspace-key");
});

test("standalone execution uses only explicit user account choices and ignores residual central credentials", () => {
  values.global = {
    aiProvider: "codex",
    model: "gpt-6-astra",
    reviewReasoningEffort: "xhigh",
    codexPath: "/user-chosen/codex",
    localProfile: "personal",
    fileTimeoutSeconds: 75,
  };
  values.repository = {
    aiProvider: "openai",
    model: "repository-model",
    codexPath: "/repo/execute-me",
    reviewReasoningEffort: "high",
    localProfile: "repository-profile",
    reviewMode: "centralized",
    serverUrl: "https://unused.invalid",
    apiKey: "synthetic-unused-key",
    clientToken: "synthetic-unused-token",
    fileTimeoutSeconds: 600,
    excludePatterns: ["private/**"],
  };
  values.reads = [];
  workspace.isTrusted = true;
  const resolved = getStandaloneReviewSettings(1);
  assert.equal(resolved.provider, "codex");
  assert.equal(resolved.model, "gpt-6-astra");
  assert.equal(resolved.reasoningEffort, "xhigh");
  assert.equal(resolved.executablePath, "/user-chosen/codex");
  assert.equal(resolved.profileId, "personal");
  assert.equal(resolved.mode, "standalone");
  assert.equal(resolved.durationMs, 75_000);
  assert.deepEqual(resolved.excludePatterns, ["private/**"]);
  assert(
    !values.reads.some((key) =>
      ["serverUrl", "apiKey", "clientToken", "endpoint"].includes(key),
    ),
  );
});

test("repository-only legacy account settings are preserved but cannot authorize a new local review", () => {
  values.global = {};
  values.repository = {
    aiProvider: "codex",
    model: "gpt-6-astra",
    codexPath: "/repo/execute-me",
    runOnStage: true,
  };
  const resolved = getStandaloneReviewSettings(3);
  assert.equal(resolved.provider, "unconfigured");
  assert.equal(resolved.model, "");
  assert.notEqual(resolved.executablePath, "/repo/execute-me");
  assert.equal(resolved.mode, "standalone");
  assert.equal(resolved.durationMs, 360_000);
  assert.equal(getConfig().runOnStage, false);
  assert.equal(values.repository.aiProvider, "codex");
});

test("new installations do not enable stage review; explicit user opt-in and workspace trust are respected", () => {
  values.global = { runOnStage: true, directoryTimeoutSeconds: 1000 };
  values.repository = { runOnStage: false };
  workspace.isTrusted = false;
  assert.equal(getConfig().runOnStage, true);
  const resolved = getStandaloneReviewSettings(2);
  assert.equal(resolved.durationMs, 600_000);
  assert.equal(resolved.workspaceTrusted, false);
  values.global = {};
  values.repository = {};
  workspace.isTrusted = true;
  assert.equal(getConfig().runOnStage, false);
});
