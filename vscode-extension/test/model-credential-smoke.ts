/** Manual macOS verification. Uses a generated synthetic key, never an existing user credential. */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { runTests } from "@vscode/test-electron";
import { defaultLocalDataDirectory } from "@gcr/client-core";
import {
  MODEL_CREDENTIAL_SERVICE,
  modelCredentialBinding,
  modelCredentialDataDirectory,
} from "../src/modelCredentials.js";
import { migrateSettingsModelCredential } from "../src/modelCredentialSettings.js";
import {
  hookConfigPath,
  hookConfigSettings,
  migrateHookModelCredential,
} from "../src/hook/config.js";

async function main() {
  assert.equal(process.platform, "darwin");
  const evidencePath = process.env.CD_CREDENTIAL_EVIDENCE;
  assert(evidencePath && path.isAbsolute(evidencePath));
  fs.writeFileSync(evidencePath, "", { flag: "wx", mode: 0o600 });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cd-cred-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const profileId = `cd-credential-${randomUUID()}`;
  const profileDirectory = path.join(
    modelCredentialDataDirectory(),
    "profiles",
    profileId,
  );
  const personalDirectory = path.join(
    defaultLocalDataDirectory(),
    "profiles",
    profileId,
  );
  assert(!fs.existsSync(profileDirectory));
  assert(!fs.existsSync(personalDirectory));
  const secret = `synthetic-${randomUUID()}`;
  const sha = (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
  let apiRequests = 0;
  const authMatches: boolean[] = [];
  const evidence: Record<string, unknown> = {
    status: "running",
    startedAt: new Date().toISOString(),
    runtime: process.version,
    credentialStore: "macOS Keychain",
    service: MODEL_CREDENTIAL_SERVICE,
    syntheticCredential: true,
    realModelCalls: 0,
    provider: "synthetic localhost API",
    visualInspection: false,
  };
  const checkpoint = () =>
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", {
      mode: 0o600,
    });
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (bytes) => {
      body += bytes;
    });
    req.on("end", () => {
      apiRequests++;
      const matched = req.headers.authorization === `Bearer ${secret}`;
      authMatches.push(matched);
      if (!matched) {
        res.writeHead(401);
        res.end("Unexpected synthetic authorization");
        return;
      }
      const message = body.includes("Generate a commit message")
        ? { commit_message: "test: verify shared model credential" }
        : {
            summary: "Synthetic transport verification.",
            blocking: false,
            grade: "proficient",
            file_comments: [],
          };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(message) },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
  });
  const invokeHook = (file: string) =>
    new Promise<{ code: number; output: string }>((resolve, reject) => {
      execFile(
        process.execPath,
        [file, repo],
        { cwd: root, timeout: 20_000, maxBuffer: 256_000 },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number") {
            reject(Error("Synthetic hook could not be executed."));
            return;
          }
          resolve({
            code: (error?.code as number) ?? 0,
            output: stdout + stderr,
          });
        },
      );
    });
  let credentialDeleted = false;
  const removeKey = () => {
    const file = path.join(profileDirectory, "local/key-ref.json");
    if (!fs.existsSync(file)) return;
    const ref = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(ref.profileId, profileId);
    assert.match(ref.id, /^[a-f0-9-]{36}$/);
    const args = [
      "-a",
      `${profileId}.${ref.id}`,
      "-s",
      MODEL_CREDENTIAL_SERVICE,
    ];
    execFileSync("/usr/bin/security", ["delete-generic-password", ...args], {
      stdio: "pipe",
    });
    let absent = false;
    try {
      execFileSync("/usr/bin/security", ["find-generic-password", ...args], {
        stdio: "pipe",
      });
    } catch (error) {
      absent = (error as { status: number }).status === 44;
    }
    assert(absent);
    credentialDeleted = true;
  };
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: repo, stdio: "pipe" },
      );
    git("init", "-b", "main");
    git("config", "user.name", "Credential fixture");
    git("config", "user.email", "fixture@example.invalid");
    fs.writeFileSync(
      path.join(repo, "fixture.ts"),
      "export const value = 1;\n",
    );
    git("add", "fixture.ts");
    git("commit", "-m", "base");
    fs.writeFileSync(
      path.join(repo, "fixture.ts"),
      "export const value = 2;\n",
    );
    git("add", "fixture.ts");
    fs.mkdirSync(path.dirname(hookConfigPath(repo)), { mode: 0o700 });
    fs.writeFileSync(
      hookConfigPath(repo),
      JSON.stringify({
        aiProvider: "openai",
        model: "fixture-model",
        endpoint,
        apiKey: secret,
      }),
      { mode: 0o600 },
    );
    const legacy = fs.readFileSync(hookConfigPath(repo), "utf8");
    const ref = await migrateHookModelCredential(repo, profileId);
    const cfg = hookConfigSettings(JSON.parse(legacy));
    let oldSetting: string | undefined = secret;
    let settingRef: unknown;
    await migrateSettingsModelCredential(
      profileId,
      modelCredentialBinding(cfg),
      secret,
      {
        isCurrent: () => true,
        readLegacy: () => oldSetting,
        readReference: () => settingRef,
        writeReference: async (value) => {
          settingRef = value;
        },
        removeLegacy: async () => {
          oldSetting = undefined;
        },
      },
    );
    assert.equal(oldSetting, undefined);
    assert.deepEqual(settingRef, ref);
    const settingsDirectory = path.join(root, "u/User");
    fs.mkdirSync(settingsDirectory, { recursive: true });
    const settings = {
      "commitDefender.aiProvider": "openai",
      "commitDefender.model": "fixture-model",
      "commitDefender.endpoint": endpoint,
      "commitDefender.modelCredentialRef": ref,
      "commitDefender.localProfile": profileId,
      "commitDefender.preCommitHook": "disable",
      "commitDefender.runOnStage": false,
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
    };
    fs.writeFileSync(
      path.join(settingsDirectory, "settings.json"),
      JSON.stringify(settings),
      { mode: 0o600 },
    );
    assert(!fs.readFileSync(hookConfigPath(repo), "utf8").includes(secret));
    assert(!JSON.stringify(settings).includes(secret));
    evidence.migration = {
      hookPlaintextRemovedAfterVerification: true,
      settingsAdapterVerified: true,
      sameReference: true,
    };
    checkpoint();
    const hostEvidence = path.join(root, "host-evidence.json");
    await runTests({
      vscodeExecutablePath:
        process.env.VSCODE_EXECUTABLE_PATH ??
        "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
      extensionDevelopmentPath: process.cwd(),
      extensionTestsPath: path.resolve("out-test/model-credential-host.cjs"),
      extensionTestsEnv: {
        CD_CREDENTIAL_PROFILE: profileId,
        CD_CREDENTIAL_WORKSPACE: repo,
        CD_CREDENTIAL_HOST_EVIDENCE: hostEvidence,
      },
      launchArgs: [
        repo,
        "--user-data-dir",
        path.join(root, "u"),
        "--extensions-dir",
        path.join(root, "extensions"),
        "--disable-extensions",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-updates",
        "--disable-telemetry",
      ],
    });
    evidence.extensionHost = JSON.parse(fs.readFileSync(hostEvidence, "utf8"));
    assert.equal(apiRequests, 1);
    assert(!fs.existsSync(personalDirectory));
    const copied = path.join(root, "hook-cli.js");
    fs.copyFileSync("out/hook-cli.js", copied);
    evidence.hookSha256 = sha(fs.readFileSync(copied));
    const hook = await invokeHook(copied);
    assert.equal(hook.code, 0);
    assert(hook.output.includes("Review: COMPLETED"));
    assert(!hook.output.includes(secret));
    assert.equal(apiRequests, 2);
    assert(authMatches.every(Boolean));
    evidence.headlessHook = {
      afterExtensionHostExit: true,
      singleCopiedBundle: true,
      completed: true,
      sameCredentialAccepted: true,
      secretAbsentFromOutput: true,
    };
    const saved = fs.readFileSync(hookConfigPath(repo), "utf8");
    const changed = JSON.parse(saved);
    changed.endpoint = "https://unused.invalid/v1";
    fs.writeFileSync(hookConfigPath(repo), JSON.stringify(changed));
    const rejected = await invokeHook(copied);
    assert(rejected.output.includes("review FAILED"));
    assert.equal(apiRequests, 2);
    fs.writeFileSync(hookConfigPath(repo), saved);
    removeKey();
    const missing = await invokeHook(copied);
    assert(missing.output.includes("review FAILED"));
    assert.equal(apiRequests, 2);
    assert(!missing.output.includes(secret));
    assert.equal(fs.readFileSync(hookConfigPath(repo), "utf8"), saved);
    evidence.endpointChangeRejected = true;
    evidence.missingKeyRejectedWithoutPlaintextFallback = true;
    evidence.apiRequests = apiRequests;
    evidence.status = "verified";
  } catch {
    evidence.status = "failed";
    evidence.failure =
      "Synthetic credential integration assertion or Extension Host execution failed. See the owned test log.";
    process.exitCode = 1;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!credentialDeleted) removeKey();
    fs.rmSync(profileDirectory, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    evidence.cleanup = "completed";
    evidence.finishedAt = new Date().toISOString();
    checkpoint();
    process.stdout.write(
      `Model credential checkpoint ${evidence.status}; synthetic resources cleaned up.\n`,
    );
  }
}
void main().catch(() => {
  process.stderr.write(
    "Model credential checkpoint could not complete cleanup. Inspect its owned profile before retrying.\n",
  );
  process.exitCode = 1;
});
