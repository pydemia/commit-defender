import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runTests } from "@vscode/test-electron";
import {
  defaultLocalDataDirectory,
  PlatformLocalKeyStore,
} from "@gcr/client-core";
const { chromium } = await import(
  process.env.CD_CHAT_PLAYWRIGHT_MODULE ?? "playwright"
);
const artifact = process.env.CD_CHAT_EXTENSION_PATH,
  executable = process.env.CD_CHAT_CODEX,
  evidence = process.env.CD_CHAT_EVIDENCE;
for (const value of [artifact, executable, evidence])
  assert(value && path.isAbsolute(value));
const resumed = process.env.CD_CHAT_RESUME_FIXTURE;
if (resumed)
  assert(
    path.isAbsolute(resumed) &&
      path.dirname(resumed) === os.tmpdir() &&
      path.basename(resumed).startsWith("cd-chat-host-"),
  );
const temporary =
  resumed ?? (await mkdtemp(path.join(os.tmpdir(), "cd-chat-host-")));
const workspace = path.join(temporary, "workspace"),
  control = path.join(temporary, "control.json"),
  profileId = resumed
    ? JSON.parse(
        await readFile(
          path.join(temporary, "user-data/User/settings.json"),
          "utf8",
        ),
      )["commitDefender.localProfile"]
    : `cd-chat-${randomUUID()}`;
assert(/^cd-chat-[0-9a-f-]{36}$/.test(profileId));
await writeFile(evidence, "{}\n", { flag: "wx", mode: 0o600 });
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const proof = async () => {
  try {
    const value = JSON.parse(await readFile(evidence, "utf8"));
    if (hostFinished && value.status !== "passed")
      throw Error("Native host ended before completing the verification");
    return value;
  } catch (error) {
    if (hostFinished) throw error;
    return {};
  }
};
const until = async (read, done, timeout = 660000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline)
      throw Error("UI observation timed out; no review was restarted");
    await new Promise((r) => setTimeout(r, 500));
  }
};
let host,
  hostFinished = false,
  browser,
  succeeded = false;
try {
  if (!resumed) {
    await mkdir(workspace);
    const git = (...args) =>
      execFileSync(
        "git",
        [
          "-C",
          workspace,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { stdio: "pipe" },
      );
    git("init", "-b", "main");
    await writeFile(
      path.join(workspace, "sum.ts"),
      "export const sum = (values: number[]) => values.reduce((a,b) => a+b, 0);\n",
    );
    await writeFile(
      path.join(workspace, "caller.ts"),
      "import { sum } from './sum.ts';\nexport const emptyTotal = () => sum([]);\n",
    );
    git("add", ".");
    git("commit", "-m", "base");
    await writeFile(
      path.join(workspace, "sum.ts"),
      "export const sum = (values: number[]) => values.reduce((a,b) => a+b);\n",
    );
    git("add", ".");
    await mkdir(path.join(temporary, "user-data/User"), { recursive: true });
    await writeFile(
      path.join(temporary, "user-data/User/settings.json"),
      JSON.stringify({
        "commitDefender.localProfile": profileId,
        "commitDefender.aiProvider": "codex",
        "commitDefender.model": "gpt-6-astra",
        "commitDefender.reviewReasoningEffort": "xhigh",
        "commitDefender.codexPath": executable,
        "commitDefender.reviewMode": "standalone",
        "commitDefender.fileTimeoutSeconds": 600,
        "commitDefender.directoryTimeoutSeconds": 600,
        "commitDefender.runOnSave": false,
        "commitDefender.runOnStage": false,
        "commitDefender.runOnCommit": false,
        "commitDefender.runOnPush": false,
        "commitDefender.preCommitHook": "disable",
        "telemetry.telemetryLevel": "off",
        "update.mode": "none",
        "extensions.autoUpdate": false,
        "workbench.startupEditor": "none",
      }),
    );
  }
  host = runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
    extensionDevelopmentPath: artifact,
    extensionTestsPath: path.resolve("out-test/review-chat-host.cjs"),
    extensionTestsEnv: {
      CD_CHAT_WORKSPACE: workspace,
      CD_CHAT_PROFILE: profileId,
      CD_CHAT_EVIDENCE: evidence,
      CD_CHAT_CONTROL: control,
      CD_CHAT_RESUMED: resumed ? "1" : "0",
    },
    launchArgs: [
      workspace,
      "--user-data-dir",
      path.join(temporary, "user-data"),
      "--extensions-dir",
      path.join(temporary, "extensions"),
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-updates",
      "--disable-telemetry",
      `--remote-debugging-port=${port}`,
    ],
  }).finally(() => {
    hostFinished = true;
  });
  host.catch(() => {});
  await until(
    async () => {
      if (hostFinished) throw Error("Host ended before opening chat");
      try {
        return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      } catch {
        return undefined;
      }
    },
    (value) => {
      if (value) browser = value;
      return !!value;
    },
  );
  const frame = () =>
    until(async () => {
      if (hostFinished) throw Error("Host ended during UI verification");
      for (const context of browser.contexts())
        for (const page of context.pages())
          for (const frame of page.frames()) {
            try {
              if (await frame.locator("#message").count()) return frame;
            } catch {
              /* A closing webview is not the new one. */
            }
          }
    }, Boolean);
  let chat;
  if (!resumed) {
    await until(proof, (p) => p.stage === "chat-open");
    chat = await frame();
    const input = chat.locator("#message");
    await input.waitFor({ state: "visible" });
    await until(() => input.isEnabled(), Boolean);
    await input.fill(
      "Explain the empty-array issue. Before recommending a fix, ask me with ask_user whether empty arrays must return zero or throw.",
    );
    await input.press("Shift+Enter");
    assert((await input.inputValue()).includes("\n"));
    await input.type(
      "This is a product choice only I can answer. Read source and base, then pause.",
    );
    await input.press("Enter");
    await until(proof, (p) => p.stage === "question-saved");
    await until(
      () => chat.locator(".question").count(),
      (n) => n > 0,
    );
    await writeFile(control, JSON.stringify({ reopen: true }));
    await until(proof, (p) => p.stage === "reopened");
    chat = await frame();
    await until(() => chat.locator("#message").isEnabled(), Boolean);
    await until(
      () => chat.locator(".question").count(),
      (n) => n > 0,
    );
    await chat
      .locator("#message")
      .fill(
        "Empty arrays must return zero. Explain the defect and correction using the captured source, base, and caller. No additional question is needed.",
      );
    await chat.locator("#send").click();
  }
  await until(proof, (p) => p.stage === "answer-complete");
  chat = await frame();
  await until(
    () => chat.locator("[data-source]").count(),
    (n) => n > 0,
  );
  await chat.locator(".answer").scrollIntoViewIfNeeded();
  await chat.page().screenshot({ path: evidence.replace(/\.json$/, ".png") });
  await chat.locator("[data-source]").first().click();
  await until(proof, (p) => p.stage === "navigation-verified");
  await writeFile(
    control,
    JSON.stringify({ reopen: true, returnToChat: true }),
  );
  await until(proof, (p) => p.stage === "navigation-returned");
  chat = await frame();
  await until(() => chat.locator("#message").isEnabled(), Boolean);
  await chat
    .locator("#message")
    .fill(
      "Read the source and base again and explain all conditions for the same finding.",
    );
  await chat.locator("#send").click();
  await until(proof, (p) => p.stage === "cancel-running");
  await until(() => chat.locator("#status").textContent(), (text) => /^Read (source|base):/.test(text ?? ""));
  await chat.locator("#cancel").click();
  await until(proof, (p) => p.stage === "cancelled");
  await writeFile(control, JSON.stringify({ reopen: true, finish: true }));
  await host;
  assert.equal((await proof()).status, "passed");
  succeeded = true;
} finally {
  // An observation failure does not imply the model/host is stopped. Preserve the
  // fixture and keys unless the native host is confirmed terminal.
  if (browser) await browser.close().catch(() => {});
  if (hostFinished && succeeded) {
    for (const base of [
      defaultLocalDataDirectory(),
      path.join(defaultLocalDataDirectory(), "review-requests"),
    ]) {
      const root = path.join(base, "profiles", profileId);
      const reference = JSON.parse(
        await readFile(path.join(root, "local/key-ref.json"), "utf8"),
      );
      assert.equal(reference.profileId, profileId);
      await new PlatformLocalKeyStore().remove(`${profileId}.${reference.id}`);
      await rm(root, { recursive: true, force: true });
    }
    await rm(temporary, { recursive: true, force: true });
    const final = await proof();
    final.fixtureAndKeysRemoved = true;
    final.resumedFixture = !!resumed;
    final.ui = {
      enterSubmits: !resumed,
      shiftEnterNewline: !resumed,
      reopenedQuestion: !resumed,
      sourceNavigation: true,
      cancelledTurn: true,
    };
    await writeFile(evidence, JSON.stringify(final, null, 2) + "\n");
  } else process.stderr.write(`Verification fixture retained: ${temporary}\n`);
}
