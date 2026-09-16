/** Explicit acceptance only: one account review through the native service. */
import * as vscode from "vscode";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  callLocalService, captureLocalSource, discoverLocalIdentity,
  LocalHistoryStore, LocalRecordStore, type ServiceJob,
} from "@gcr/client-core";
import { prepareCodexAccountExecutor } from "@gcr/client-executors";

const sha256 = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms: number) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() >= deadline) throw Error("W03 observation timed out.");
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}
export async function run() {
  assert.equal(process.platform, "win32");
  const config = JSON.parse(fs.readFileSync(process.env.W03_CONFIGURATION!, "utf8"));
  assert.equal(config.maximumReviewInvocations, 1);
  assert.equal(config.model, "gpt-5.6-luna");
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.durationMs, 240000);
  assert(path.basename(path.dirname(config.workspace)).startsWith("cd-w03-host-"));
  const root = fs.realpathSync(config.workspace);
  const location = { profileId: config.profileId };
  const extension = vscode.extensions.getExtension("pydemia.commit-defender")!;
  assert(extension);
  const proof: Record<string, any> = {
    status: "preparing", platform: process.platform, arch: process.arch,
    node: process.version, vscode: vscode.version,
    extensionVersion: extension.packageJSON.version,
    extensionPath: extension.extensionPath,
    extensionSha256: sha256(path.join(extension.extensionPath, "out/extension.js")),
    standaloneWorkerSha256: sha256(path.join(extension.extensionPath, "out/standalone-review-worker.js")),
    syntheticResponse: false, realModel: false, modelCalls: 0,
    maximumReviewInvocations: 1, timeoutMs: 240000,
    trigger: "commit", centralConnection: false,
    accountSource: "existing default Codex account via auth-only NTFS link",
    expected: "completed report identifies subtraction instead of addition in sum.ts; stored report can be reopened",
    route: "Extension Host opt-in -> Git for Windows pre-commit -> native Node advisory -> IPC -> native service review worker -> isolated Codex",
    workerPlacement: "private CLI service executes its review worker in the service Node process",
    processes: [],
  };
  const save = () => fs.writeFileSync(process.env.W03_EVIDENCE!, JSON.stringify(proof, null, 2) + "\n");
  const git = (...args: string[]) => execFileSync("git", ["-C", root,
    "-c", "commit.gpgsign=false", "-c", "user.name=W03 Fixture",
    "-c", "user.email=fixture@example.invalid", ...args], {
    encoding: "utf8", stdio: "pipe", windowsHide: true, timeout: 60000,
  }).trim();
  const cfg = vscode.workspace.getConfiguration("commitDefender");
  const status = () => callLocalService(location, { action: "status" }) as Promise<{
    pid: number; status: string; jobs: ServiceJob[];
  }>;
  let submitted: string | undefined;
  let serviceOwned = false;
  save();
  try {
    await extension.activate();
    assert(vscode.workspace.isTrusted);
    for (const field of ["Save", "Stage", "Commit", "Push"])
      assert.equal(cfg.get(`runOn${field}`), false);
    // Catalog/auth preparation does not submit a model review.
    await prepareCodexAccountExecutor({ executablePath: config.executablePath,
      model: config.model, reasoningEffort: config.reasoningEffort });
    proof.catalogPreparation = "passed; zero review invocations";
    await cfg.update("runOnCommit", true, vscode.ConfigurationTarget.Global);
    await until(async () => {
      try {
        const reg = await callLocalService(location, { action: "registration", root }, 3000) as any;
        return reg?.triggers?.length === 1 && reg.triggers[0] === "commit" &&
          reg.options.model === config.model && reg.options.reasoningEffort === "high" &&
          reg.options.durationMs === 240000 && git("config", "core.hooksPath").includes("managed-hooks");
      } catch { return false; }
    }, Boolean, 90000);
    serviceOwned = true;
    const before = await status();
    assert.equal(before.status, "running");
    assert.equal(before.jobs.length, 0);
    proof.servicePid = before.pid;
    proof.hookDirectory = git("config", "core.hooksPath");
    const state = JSON.parse(fs.readFileSync(path.join(proof.hookDirectory, "state.json"), "utf8"));
    const route = state.routes[root];
    assert(route);
    proof.serviceProgram = route.cli;
    proof.advisoryProgram = state.files["pre-commit"] ? fs.readFileSync(
      path.join(proof.hookDirectory, "pre-commit"), "utf8",
    ).match(/exec '[^']+' '([^']+advisory\.cjs)'/)?.[1] : undefined;
    proof.serviceSha256 = sha256(route.cli);
    proof.serviceHelperSha256 = sha256(path.join(path.dirname(route.cli), "windows-native.exe"));
    proof.serviceHelperManifest = JSON.parse(fs.readFileSync(path.join(path.dirname(route.cli), "windows-native.json"), "utf8"));
    proof.servicePackage = JSON.parse(fs.readFileSync(path.join(extension.extensionPath, "out/gcr-service/manifest.json"), "utf8"));
    assert.equal(proof.serviceSha256, proof.servicePackage.bundleSha256);
    assert.equal(proof.serviceHelperSha256, proof.serviceHelperManifest.sha256);
    assert.equal(proof.serviceHelperSha256,
      sha256(path.join(extension.extensionPath, "out/windows-native.exe")));
    const snapshot = captureLocalSource({ cwd: root, kind: "index", paths: ["sum.ts"] });
    try {
      proof.source = snapshot.identity;
      proof.fixedFiles = snapshot.freeze().files.map((file) => ({
        path: file.source.path, side: file.source.side,
        sha256: createHash("sha256").update(file.text).digest("hex"),
      }));
    } finally { snapshot.close(); }
    proof.context = {
      source: "sum.ts uses total - value", base: "sum.ts uses total + value",
      caller: "consumer.ts invoiceTotal delegates to sum",
      rules: "sum([])=0; invoiceTotal([2,3])=5",
      tests: "sum.test.ts provides addition and empty-list boundary assertions",
      testExecution: "runner executes fixture tests before review; model reading tests is not test execution",
    };
    proof.status = "call-planned";
    save();
    // This is the sole review trigger. There is no retry or second commit.
    proof.startedAt = new Date().toISOString();
    proof.status = "running";
    proof.realModel = true;
    proof.reviewTriggerAttempts = 1;
    proof.modelCallCountConfirmed = false;
    save();
    git("commit", "-m", "W03 isolated defect fixture");
    const first = (await status()).jobs;
    assert.equal(first.length, 1);
    submitted = first[0].id;
    proof.receipt = first[0];
    const ps = path.join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/powershell.exe");
    const observed = new Map<number, unknown>();
    const final = await until(async () => {
      const rows = JSON.parse(execFileSync(ps, ["-NoProfile", "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json -Compress"],
        { encoding: "utf8", windowsHide: true, timeout: 10000 }));
      const owned = new Set<number>([before.pid]);
      for (let depth = 0; depth < 8; depth++) for (const row of rows)
        if (owned.has(row.ParentProcessId) || row.ProcessId === before.pid) {
          owned.add(row.ProcessId); observed.set(row.ProcessId, row);
        }
      proof.processes = [...observed.values()];
      if (proof.processes.some((row: { Name: string }) => row.Name.toLowerCase() === "codex.exe")) {
        proof.modelCalls = 1;
        proof.modelCallCountConfirmed = true;
      }
      const job = await callLocalService(location, { action: "job", id: submitted }) as ServiceJob;
      proof.receipt = job; save(); return job;
    }, (job) => !["queued", "running"].includes(job.state), 300000);
    proof.finishedAt = new Date().toISOString();
    assert.equal(final.state, "finished");
    assert.equal(final.result?.status, "completed");
    assert.equal(final.result?.exitCode, 0);
    assert(final.result?.runId);
    const identity = discoverLocalIdentity(root, config.profileId);
    const scope = { kind: "repository" as const, profileId: config.profileId,
      repositoryKey: identity.repositoryKey, worktreeKey: identity.worktreeKey };
    const records = await LocalRecordStore.open({ scope });
    let report;
    try { report = await new LocalHistoryStore(records).getReview(final.result.runId); }
    finally { records.close(); }
    assert(report);
    proof.report = report;
    proof.modelCalls = 1;
    proof.modelCallCountConfirmed = true;
    save();
    assert.equal(report.status, "completed");
    assert.equal(report.problems.length, 0);
    assert.equal(report.identity.executor.model, config.model);
    assert.equal(report.identity.source.hash, proof.source.hash);
    assert(report.findings.some((finding) => finding.anchor.path === "sum.ts" &&
      finding.anchor.startLine <= 2 && finding.anchor.endLine >= 2 &&
      finding.anchorValidation.status === "verified" &&
      finding.evidenceAssessment.level === "source-confirmed"));
    assert(!JSON.stringify(report).includes("W03_EXCLUDED_SECRET"));
    assert(!JSON.stringify(report).includes('"unknown-read-id"'));
    const reopened = await LocalRecordStore.open({ scope });
    try { assert.deepEqual(await new LocalHistoryStore(reopened).getReview(report.runId), report); }
    finally { reopened.close(); }
    proof.encryptedHistoryReopened = true;
    await vscode.commands.executeCommand("commitDefender.refreshLocalHistory");
    proof.historyRefreshCommand = true;
    proof.status = "passed";
  } catch (error) {
    proof.status = "failed";
    proof.failure = error instanceof Error ? error.message : "W03 Host failed";
    save();
    throw error;
  } finally {
    try {
    if (submitted && proof.status !== "passed")
      await callLocalService(location, { action: "cancel", id: submitted }).catch(() => undefined);
    await cfg.update("automaticReviewsPaused", true, vscode.ConfigurationTarget.Global);
    if (serviceOwned) {
      await until(async () => {
        const reg = await callLocalService(location, { action: "registration", root }) as any;
        return reg && reg.triggers.length === 0 && git("config", "core.hooksPath") === ".hooks";
      }, Boolean, 30000);
      proof.pauseRestoredHooksAndRevokedGrants = true;
    }
    } catch (error) {
      proof.cleanupFailure = error instanceof Error ? error.message : "Host cleanup unconfirmed";
      proof.status = "failed";
      throw error;
    } finally { save(); }
  }
}
