/** Explicit real-account checkpoint, excluded from npm test and VSIX. Synthetic repositories only. */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  clientReviewReport,
  reviewExitCode,
  type ClientReviewReport,
} from "@gcr/client-contract";
import { defaultLocalDataDirectory } from "@gcr/client-core";
import { prepareStandaloneWorker } from "../src/standaloneWorkerClient.js";
import {
  readRecordedSource,
  retainCapturedSources,
} from "../src/reviewSource.js";
import {
  knowledgeScope,
  readLocalHistory,
  withLocalKnowledge,
  checkLocalContextFreshness,
} from "../src/localKnowledge.js";

const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const signal = () => new AbortController().signal;

// A fresh Node process loads the same storage code used by the extension, without test ports.
async function inspectProcess(
  repoRoot: string,
  profileId: string,
): Promise<void> {
  const scope = knowledgeScope({ repoRoot, profileId, scope: "repository" });
  const history = await readLocalHistory({
    repoRoot,
    profileId,
    scope: "repository",
  });
  const knowledge = await withLocalKnowledge(scope, (store) => store.list());
  const freshness = history[0]
    ? await checkLocalContextFreshness(history[0])
    : undefined;
  process.stdout.write(JSON.stringify({ history, knowledge, freshness }));
}

const pyFixed =
  'def load(keys: list[str], cache: dict[str, int]) -> dict[str, int]:\n    """Return every requested key; missing keys default to zero."""\n    return {key: cache.get(key, 0) for key in keys}\n';
const pyBug =
  'def load(keys: list[str], cache: dict[str, int]) -> dict[str, int]:\n    """Return every requested key; missing keys default to zero."""\n    if cache:\n        return cache\n    return {key: cache.get(key, 0) for key in keys}\n';
const pyNormal =
  'def load(keys: list[str], cache: dict[str, int]) -> dict[str, int]:\n    """Return every requested key; missing keys default to zero."""\n    result = {}\n    for key in keys:\n        result[key] = cache.get(key, 0)\n    return result\n';
const tsFixed =
  "/** Sum finite safe integers; the sum is a safe integer. Empty input returns zero. */\nexport function total(items: number[]): number {\n  return Number(items.reduce((sum, item) => sum + BigInt(item), 0n));\n}\n";
const tsBug =
  "/** Sum finite safe integers; the sum is a safe integer. Empty input returns zero. */\nexport function total(items: number[]): number {\n  return Number(items.map(BigInt).reduce((sum, item) => sum + item));\n}\n";
const tsNormal =
  "/** Sum finite safe integers; the sum is a safe integer. Empty input returns zero. */\nexport function total(items: number[]): number {\n  let sum = 0n;\n  for (const item of items) sum += BigInt(item);\n  return Number(sum);\n}\n";

function invoke(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; input?: string },
) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = execFile(
        command,
        args,
        {
          cwd: options.cwd,
          env: options.env,
          timeout: 240_000,
          maxBuffer: 8 * 1024 * 1024,
          killSignal: "SIGINT",
        },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number")
            return reject(Error("Child process exceeded its boundary."));
          resolve({
            exitCode: typeof error?.code === "number" ? error.code : 0,
            stdout,
            stderr,
          });
        },
      );
      child.stdin?.end(options.input);
    },
  );
}

async function main(): Promise<void> {
  if (process.argv[2] === "inspect") {
    await inspectProcess(process.argv[3]!, process.argv[4]!);
    return;
  }
  const executablePath = process.env.CD_SMOKE_CODEX_EXECUTABLE;
  const cliPath = process.env.CD_SMOKE_CLI_PATH;
  const evidencePath = process.env.CD_SMOKE_EVIDENCE;
  const cases = process.env.CD_SMOKE_CASES?.split(",");
  const durationMs = Number(process.env.CD_SMOKE_TIMEOUT_MS ?? 180_000);
  assert.equal(process.platform, "darwin");
  assert(executablePath && path.isAbsolute(executablePath));
  assert(cliPath && path.isAbsolute(cliPath));
  assert(evidencePath && path.isAbsolute(evidencePath));
  assert(
    cases?.length &&
      cases.every((value) =>
        /^(python|typescript)\/(defect|fix|normal)$/.test(value),
      ),
  );
  assert(
    Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= 180_000,
  );
  fs.writeFileSync(evidencePath, "", { flag: "wx", mode: 0o600 });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cd-standalone-smoke-"));
  const profileId = `cd-smoke-${randomUUID()}`;
  const profileDirectory = path.join(
    defaultLocalDataDirectory(),
    "profiles",
    profileId,
  );
  assert(!fs.existsSync(profileDirectory));
  const workerFile = path.join(root, "worker", "standalone-review-worker.cjs");
  fs.mkdirSync(path.dirname(workerFile));
  const originalWorker = path.resolve(
    process.env.CD_SMOKE_WORKER_PATH ?? "out/standalone-review-worker.js",
  );
  fs.copyFileSync(originalWorker, workerFile);
  assert.equal(
    sha(fs.readFileSync(originalWorker)),
    sha(fs.readFileSync(workerFile)),
  );
  assert.deepEqual(fs.readdirSync(path.dirname(workerFile)), [
    path.basename(workerFile),
  ]);
  let centralRequests = 0;
  const central = http.createServer((_request, response) => {
    centralRequests++;
    response.writeHead(500).end();
  });
  await new Promise<void>((resolve) => central.listen(0, "127.0.0.1", resolve));
  const address = central.address();
  assert(address && typeof address === "object");
  const env = {
    ...process.env,
    GCR_SERVER_URL: `http://127.0.0.1:${address.port}`,
    GCR_TOKEN: "synthetic-unused-central-token",
  };
  const previousServer = process.env.GCR_SERVER_URL,
    previousToken = process.env.GCR_TOKEN;
  process.env.GCR_SERVER_URL = env.GCR_SERVER_URL;
  process.env.GCR_TOKEN = env.GCR_TOKEN;
  const evidence: Record<string, unknown> = {
    status: "running",
    startedAt: new Date().toISOString(),
    runtime: process.version,
    workerSha256: sha(fs.readFileSync(workerFile)),
    workerSelfContained: true,
    diagnosticWorker: !!process.env.CD_SMOKE_WORKER_PATH,
    cliSha256: sha(fs.readFileSync(cliPath)),
    model: "gpt-6-astra",
    reasoningEffort: "xhigh",
    durationMs,
    sourceKind: "index",
    fixtureRunnerSeparateFromModel: true,
    gui: "not-run",
    workerRunAttempts: 0,
    cases: [],
  };
  const checkpoint = () =>
    fs.writeFileSync(
      evidencePath,
      JSON.stringify({ ...evidence, centralRequests }, null, 2) + "\n",
      { mode: 0o600 },
    );
  const cli = async (repo: string, args: string[], input?: string) => {
    const response = await invoke(
      process.execPath,
      [cliPath, ...args, "--cwd", repo, "--profile", profileId],
      { cwd: root, env, input },
    );
    return { ...response, value: JSON.parse(response.stdout) };
  };
  const git = (repo: string, ...args: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        repo,
        "-c",
        "user.name=CD Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      {
        encoding: "utf8",
        stdio: "pipe",
        env: {
          PATH: process.env.PATH,
          HOME: root,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
        },
      },
    ).trim();
  let liveJob: Awaited<ReturnType<typeof prepareStandaloneWorker>> | undefined;
  try {
    checkpoint();
    for (const requested of cases) {
      const [language, variant] = requested.split("/");
      const python = language === "python";
      const repo = path.join(root, requested.replace("/", "-"));
      fs.mkdirSync(repo);
      const file = python ? "cache.py" : "sum.ts",
        caller = python ? "caller.py" : "caller.ts";
      const testFile = python ? "test_cache.py" : "sum.test.ts";
      const fixed = python ? pyFixed : tsFixed,
        bug = python ? pyBug : tsBug;
      const base = variant === "fix" ? bug : fixed;
      const source =
        variant === "defect"
          ? bug
          : variant === "normal"
            ? python
              ? pyNormal
              : tsNormal
            : fixed;
      git(repo, "init", "-b", "main");
      fs.writeFileSync(path.join(repo, file), base);
      fs.writeFileSync(
        path.join(repo, caller),
        python
          ? 'from cache import load\n\ndef render():\n    values = load(["a", "b"], {"a": 1})\n    return values["a"] + values["b"]\n'
          : 'import { total } from "./sum.ts";\nexport function renderEmpty(): number { return total([]); }\n',
      );
      fs.writeFileSync(
        path.join(repo, testFile),
        python
          ? 'from cache import load\nfrom caller import render\n\nassert load(["a", "b"], {"a": 1}) == {"a": 1, "b": 0}\nassert load(["a"], {"a": 1}) == {"a": 1}\nassert load([], {}) == {}\nassert render() == 1\n'
          : 'import assert from "node:assert/strict";\nimport { total } from "./sum.ts";\nimport { renderEmpty } from "./caller.ts";\nassert.equal(total([]), 0);\nassert.equal(total([1, -1, 0]), 0);\nassert.equal(total([Number.MAX_SAFE_INTEGER]), Number.MAX_SAFE_INTEGER);\nassert.equal(total([Number.MAX_SAFE_INTEGER, 2, -2]), Number.MAX_SAFE_INTEGER);\nassert.equal(total([-Number.MAX_SAFE_INTEGER, -2, 2]), -Number.MAX_SAFE_INTEGER);\nassert.equal(renderEmpty(), 0);\n',
      );
      if (!python)
        fs.writeFileSync(
          path.join(repo, "package.json"),
          '{"type":"module","engines":{"node":">=22.18"}}\n',
        );
      git(repo, "add", ".");
      git(repo, "commit", "-m", "base");
      const test = async () => {
        const result = await invoke(
          python ? "python3" : process.execPath,
          python
            ? [
                "-B",
                "-I",
                "-c",
                "import runpy,sys;sys.path.insert(0,sys.argv[1]);runpy.run_path(sys.argv[2])",
                repo,
                path.join(repo, testFile),
              ]
            : ["--experimental-strip-types", path.join(repo, testFile)],
          { cwd: repo },
        );
        assert([0, 1].includes(result.exitCode));
        if (result.exitCode)
          assert(
            result.stderr.includes(python ? "AssertionError" : "TypeError"),
          );
        return { exitCode: result.exitCode };
      };
      const baseTest = await test();
      assert.equal(baseTest.exitCode, variant === "fix" ? 1 : 0);
      fs.writeFileSync(path.join(repo, file), source);
      git(repo, "add", file);
      const sourceTest = await test();
      assert.equal(sourceTest.exitCode, variant === "defect" ? 1 : 0);
      const indexHash = sha(fs.readFileSync(path.join(repo, ".git/index")));
      const location = {
        repoRoot: repo,
        profileId,
        scope: "repository" as const,
      };
      const scope = knowledgeScope(location);
      const memory = await cli(
        repo,
        ["memory", "create", "--input", "-"],
        JSON.stringify({
          title: "Synthetic caller contract",
          body: "Inspect the fixed caller and test sources before reaching a conclusion. Tests are run separately from the model.",
        }),
      );
      assert.equal(memory.exitCode, 0);
      const activated = await cli(repo, [
        "memory",
        "activate",
        memory.value.id,
        "--revision",
        "1",
      ]);
      assert.equal(activated.exitCode, 0);
      const fromExtension = await withLocalKnowledge(scope, (store) =>
        store.get(memory.value.id),
      );
      assert.equal(fromExtension?.state, "active");
      assert.equal(fromExtension?.revision, 2);
      const edited = await withLocalKnowledge(scope, (store) =>
        store.edit(memory.value.id, 2, {
          title: "Synthetic caller and test contract",
        }),
      );
      assert.equal(
        (await cli(repo, ["memory", "show", memory.value.id])).value.hash,
        edited.hash,
      );
      const record: Record<string, unknown> = {
        case: requested,
        status: "preparing",
        fixture: {
          file,
          caller,
          testFile,
          base,
          source,
          baseSha256: sha(base),
          sourceSha256: sha(source),
          baseTest,
          sourceTest,
        },
        knowledge: {
          id: edited.id,
          revision: edited.revision,
          hash: edited.hash,
          cliToExtension: true,
          extensionToCli: true,
        },
      };
      (evidence.cases as unknown[]).push(record);
      checkpoint();
      process.stdout.write(`Preparing ${requested}\n`);
      const preparationController = new AbortController();
      const timer = setTimeout(
        () => preparationController.abort("timeout"),
        durationMs,
      );
      try {
        liveJob = await prepareStandaloneWorker(
          workerFile,
          { repoRoot: repo, files: [file], scope: "staged" },
          {
            mode: "standalone",
            profileId,
            provider: "codex",
            model: "gpt-6-astra",
            reasoningEffort: "xhigh",
            executablePath,
            workspaceTrusted: true,
            durationMs,
            excludePatterns: [],
          },
          preparationController.signal,
        );
      } finally {
        clearTimeout(timer);
      }
      assert.equal(
        sha(fs.readFileSync(path.join(repo, ".git/index"))),
        indexHash,
      );
      record.status = "running";
      record.executionKey = liveJob.key;
      evidence.workerRunAttempts = Number(evidence.workerRunAttempts) + 1;
      checkpoint();
      const result = await liveJob.run(signal());
      liveJob = undefined;
      const report = clientReviewReport(result.report.gcr?.report);
      const diagnostic = path.join(repo, ".cd-diagnostic.json");
      if (process.env.CD_SMOKE_WORKER_PATH && fs.existsSync(diagnostic))
        record.modelOutputDiagnostic = JSON.parse(
          fs.readFileSync(diagnostic, "utf8"),
        );
      Object.assign(record, {
        status: report.status,
        report,
        diagnostic: result.stderr,
        exitCode: reviewExitCode(report),
      });
      checkpoint();
      process.stdout.write(
        `${requested}: ${report.status}, exit ${reviewExitCode(report)}, ${report.findings.length} finding(s)\n`,
      );
      const cliResult = await cli(repo, ["result", report.runId]);
      assert.deepEqual(cliResult.value, report);
      const reopened = await invoke(
        process.execPath,
        [__filename, "inspect", repo, profileId],
        { cwd: root, env },
      );
      assert.equal(reopened.exitCode, 0);
      const reloaded = JSON.parse(reopened.stdout) as {
        history: ClientReviewReport[];
        freshness: { status: string };
        knowledge: Array<{ hash: string }>;
      };
      assert.deepEqual(reloaded.history[0], report);
      assert.equal(reloaded.freshness.status, "current");
      assert(reloaded.knowledge.some((entry) => entry.hash === edited.hash));
      record.history = {
        cliExactMatch: true,
        freshExtensionProcessExactMatch: true,
      };
      assert.equal(result.stderr, "");
      assert.equal(
        sha(fs.readFileSync(path.join(repo, ".git/index"))),
        indexHash,
      );
      assert.equal(fs.readFileSync(path.join(repo, file), "utf8"), source);
      record.originalSourceAndIndexUnchanged = true;
      assert.equal(result.capturedSources?.[file], source);
      retainCapturedSources(result.report, result.capturedSources);
      fs.writeFileSync(
        path.join(repo, file),
        "Changed after the completed review.\n",
      );
      try {
        assert.equal(readRecordedSource(repo, result.report, file), source);
      } finally {
        fs.writeFileSync(path.join(repo, file), source);
      }
      record.sourceNavigation = {
        selectedSourceRetainedAfterWorkerExit: true,
        resolvesExactCapturedBytesAfterWorkingTreeEdit: true,
        guiVerified: false,
      };
      const deactivated = await cli(repo, [
        "memory",
        "deactivate",
        edited.id,
        "--revision",
        String(edited.revision),
      ]);
      assert.equal(deactivated.exitCode, 0);
      const stale = await checkLocalContextFreshness(report);
      assert.equal(stale.status, "stale");
      assert(
        stale.changes.some(
          (entry) => entry.id === edited.id && entry.reason === "inactive",
        ),
      );
      await withLocalKnowledge(scope, (store) =>
        store.remove(edited.id, deactivated.value.revision),
      );
      const removed = await checkLocalContextFreshness(report);
      assert(
        removed.changes.some(
          (entry) => entry.id === edited.id && entry.reason === "removed",
        ),
      );
      assert(
        !(await cli(repo, ["memory", "list"])).value.some(
          (entry: { id: string }) => entry.id === edited.id,
        ),
      );
      record.knowledgeLifecycle = {
        deactivationObserved: true,
        deletionObserved: true,
      };
      checkpoint();
      assert.equal(report.status, "completed");
      assert.equal(reviewExitCode(report), variant === "defect" ? 1 : 0);
      assert.equal(result.report.review.blocking, false);
      assert.equal(report.identity.executor.model, "gpt-6-astra");
      assert(
        report.identity.context.entries.some(
          (entry) =>
            entry.origin === "local" &&
            entry.id === edited.id &&
            entry.hash === edited.hash,
        ),
      );
      for (const [side, hash] of [
        ["source", sha(source)],
        ["base", sha(base)],
      ])
        assert(
          report.evidence.some(
            (entry) =>
              entry.kind === "source-read" &&
              entry.location.path === file &&
              entry.location.side === side &&
              entry.location.hash === hash,
          ),
        );
      assert(!report.evidence.some((entry) => entry.kind === "test-execution"));
      if (variant === "defect")
        assert(
          report.findings.some(
            (finding) =>
              finding.anchor?.path === file &&
              finding.evidenceAssessment.level === "source-confirmed",
          ),
        );
      else assert.equal(report.findings.length, 0);
      record.verified = true;
      checkpoint();
    }
    assert.equal(centralRequests, 0);
    evidence.status = "verified";
  } catch (error) {
    evidence.status = "failed";
    // Assertion diagnostics may only describe these synthetic fixtures. Provider output is never recorded.
    evidence.failure =
      error instanceof Error
        ? error.message.slice(0, 1000)
        : "Checkpoint failed.";
    process.exitCode = 1;
  } finally {
    await liveJob?.dispose?.();
    await new Promise<void>((resolve) => central.close(() => resolve()));
    if (previousServer === undefined) delete process.env.GCR_SERVER_URL;
    else process.env.GCR_SERVER_URL = previousServer;
    if (previousToken === undefined) delete process.env.GCR_TOKEN;
    else process.env.GCR_TOKEN = previousToken;
    const referenceFile = path.join(profileDirectory, "local/key-ref.json");
    if (fs.existsSync(referenceFile)) {
      const reference = JSON.parse(fs.readFileSync(referenceFile, "utf8"));
      assert.equal(reference.profileId, profileId);
      assert.match(reference.id, /^[a-f0-9-]{36}$/);
      const args = [
        "-a",
        `${profileId}.${reference.id}`,
        "-s",
        "com.commitdefender.local-knowledge.v1",
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
      assert(absent, "Synthetic OS credential cleanup could not be confirmed.");
    }
    fs.rmSync(profileDirectory, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    evidence.cleanup = "completed";
    evidence.finishedAt = new Date().toISOString();
    checkpoint();
    process.stdout.write(
      `Checkpoint ${evidence.status}; cleanup completed; central requests ${centralRequests}\n`,
    );
  }
}

void main().catch(() => {
  process.stderr.write(
    "Standalone checkpoint setup or cleanup failed. Inspect its evidence before retrying.\n",
  );
  process.exitCode = 1;
});
