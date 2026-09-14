import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import {
  configureManagedHooks,
  type HookRoute,
} from "../src/hook/managedHooks.js";

function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cd-managed 'hooks-")),
    repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, "-c", "commit.gpgsign=false", ...args], {
      env,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  fs.writeFileSync(path.join(repo, "a.ts"), "export const a=1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const calls = path.join(root, "calls.jsonl"),
    cli = path.join(root, "fixture-cli.cjs");
  fs.writeFileSync(
    cli,
    `const fs=require('fs');let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({argv:process.argv.slice(2),input,index:process.env.GIT_INDEX_FILE,cwd:process.cwd()})+'\\n');process.stdout.write(JSON.stringify({status:'accepted',receipt:{id:'00000000-0000-0000-0000-000000000001'}}));process.exitCode=Number(process.env.GCR_FIXTURE_EXIT||0);});`,
  );
  const adapter = path.resolve("out/advisory-hook.cjs");
  const route: HookRoute = {
    profileId: "fixture",
    dataDirectory: path.join(root, "data"),
    node: process.execPath,
    cli,
    triggers: ["commit", "push"],
    waitMs: 0,
  };
  const storage = path.join(root, "storage");
  const configure = (cwd = repo, value: HookRoute | undefined = route) =>
    configureManagedHooks({
      root: cwd,
      storage,
      adapter,
      ...(value ? { route: value } : {}),
    });
  const remove = (cwd = repo) =>
    configureManagedHooks({ root: cwd, storage, adapter });
  const records = () =>
    fs.existsSync(calls)
      ? fs
          .readFileSync(calls, "utf8")
          .trim()
          .split("\n")
          .map((s) => JSON.parse(s))
      : [];
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    repo,
    git,
    configure,
    remove,
    route,
    adapter,
    calls,
    records,
    env,
  };
}
test("preserves original hook bytes, exit status, stdout and every pre-push stdin byte", async (t) => {
  const f = fixture(t),
    originalDir = path.join(f.repo, ".hooks");
  fs.mkdirSync(originalDir);
  const capture = path.join(f.root, "original-stdin");
  const original =
    "#!/bin/sh\ncat > " +
    "'" +
    capture.replace(/'/g, "'\\''") +
    "'" +
    '\nprintf "original output\\n"\nexit "${GCR_ORIGINAL_EXIT:-0}"\n';
  const originalPath = path.join(originalDir, "pre-push");
  fs.writeFileSync(originalPath, original, { mode: 0o755 });
  f.git(f.repo, "config", "core.hooksPath", ".hooks");
  const installed = await f.configure();
  assert.equal(installed.status, "installed");
  const overlay = f.git(f.repo, "config", "core.hooksPath");
  const input =
    "refs/heads/a " +
    "a".repeat(40) +
    " refs/heads/a " +
    "b".repeat(40) +
    "\n\u0000trailing bytes\n";
  const invoke = (code: number, failure = false) =>
    spawnSync(path.join(overlay, "pre-push"), ["origin", "local-fixture"], {
      cwd: f.repo,
      env: {
        ...f.env,
        GCR_ORIGINAL_EXIT: String(code),
        GCR_FIXTURE_EXIT: failure ? "2" : "0",
      },
      input,
      encoding: "utf8",
    });
  const blocked = invoke(7);
  assert.equal(blocked.status, 7);
  assert.equal(blocked.stdout, "original output\n");
  assert.equal(f.records().length, 0);
  const accepted = invoke(0);
  assert.equal(accepted.status, 0);
  assert.equal(accepted.stdout, "original output\n");
  assert.equal(fs.readFileSync(capture, "utf8"), input);
  assert.equal(f.records()[0].input, input);
  assert(f.records()[0].argv.includes("enqueue-push"));
  const unavailable = invoke(0, true);
  assert.equal(unavailable.status, 0);
  assert.match(unavailable.stderr, /unconfirmed/);
  assert.equal(fs.readFileSync(originalPath, "utf8"), original);
  assert.equal(fs.statSync(originalPath).mode & 0o777, 0o755);
  await f.remove();
  assert.equal(f.git(f.repo, "config", "core.hooksPath"), ".hooks");
  assert.equal(fs.readFileSync(originalPath, "utf8"), original);
  await f.configure();
  await f.remove();
});
test("actual partial commit preserves temporary index and unrelated staged changes", async (t) => {
  const f = fixture(t);
  await f.configure();
  fs.writeFileSync(path.join(f.repo, "other.ts"), "export const other=2;\n");
  f.git(f.repo, "add", "other.ts");
  fs.writeFileSync(path.join(f.repo, "a.ts"), "export const a=2;\n");
  f.git(f.repo, "commit", "--only", "-m", "partial", "--", "a.ts");
  assert.equal(f.records().length, 1);
  assert(f.records()[0].index);
  assert(f.records()[0].argv.includes("commit"));
  assert.equal(f.git(f.repo, "show", ":other.ts"), "export const other=2;");
  assert.throws(() => f.git(f.repo, "show", "HEAD:other.ts"));
  await f.remove();
  assert.throws(() =>
    f.git(f.repo, "config", "--local", "--get", "core.hooksPath"),
  );
});
test("shared hooks route only explicitly enabled worktrees and restore after the final removal", async (t) => {
  const f = fixture(t),
    second = path.join(f.root, "linked");
  f.git(f.repo, "worktree", "add", "-b", "second", second);
  const original = path.join(f.repo, ".git/hooks/pre-commit");
  fs.writeFileSync(original, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await f.configure();
  f.git(second, "commit", "--allow-empty", "-m", "not registered");
  assert.equal(f.records().length, 0);
  await f.configure(second);
  f.git(second, "commit", "--allow-empty", "-m", "registered");
  assert.equal(f.records().length, 1);
  await f.remove();
  f.git(f.repo, "commit", "--allow-empty", "-m", "disabled");
  assert.equal(f.records().length, 1);
  f.git(second, "commit", "--allow-empty", "-m", "still registered");
  assert.equal(f.records().length, 2);
  await f.remove(second);
  assert.throws(() =>
    f.git(f.repo, "config", "--local", "--get", "core.hooksPath"),
  );
  assert.equal(fs.readFileSync(original, "utf8"), "#!/bin/sh\nexit 0\n");
});
test("forwards later-created hooks and preserves user changes to hooksPath on uninstall", async (t) => {
  const f = fixture(t);
  await f.configure();
  const marker = path.join(f.root, "post-commit");
  fs.writeFileSync(
    path.join(f.repo, ".git/hooks/post-commit"),
    "#!/bin/sh\ntouch " + "'" + marker.replace(/'/g, "'\\''") + "'" + "\n",
    { mode: 0o700 },
  );
  f.git(f.repo, "commit", "--allow-empty", "-m", "forward");
  assert(fs.existsSync(marker));
  f.git(f.repo, "config", "core.hooksPath", "new-user-hooks");
  await assert.rejects(f.remove(), /changed outside/);
  assert.equal(f.git(f.repo, "config", "core.hooksPath"), "new-user-hooks");
});
test("detects edits to owned wrappers and falls back to original when Node is missing", async (t) => {
  const f = fixture(t),
    marker = path.join(f.root, "original-called");
  fs.writeFileSync(
    path.join(f.repo, ".git/hooks/pre-commit"),
    "#!/bin/sh\ntouch " +
      "'" +
      marker.replace(/'/g, "'\\''") +
      "'" +
      "\nexit 4\n",
    { mode: 0o700 },
  );
  await f.configure(f.repo, {
    ...f.route,
    node: path.join(f.root, "missing-node"),
  });
  const overlay = f.git(f.repo, "config", "core.hooksPath");
  assert.equal(
    spawnSync(path.join(overlay, "pre-commit"), [], { cwd: f.repo, env: f.env })
      .status,
    4,
  );
  assert(fs.existsSync(marker));
  fs.appendFileSync(path.join(overlay, "pre-commit"), "# user edit\n");
  await assert.rejects(f.remove(), /changed outside/);
  assert.match(
    fs.readFileSync(path.join(overlay, "pre-commit"), "utf8"),
    /user edit/,
  );
});
test('respects existing worktree-specific hooksPath without changing the main worktree', async t => {
  const f = fixture(t), second = path.join(f.root, 'separate');
  f.git(f.repo, 'config', 'extensions.worktreeConfig', 'true');
  f.git(f.repo, 'worktree', 'add', '-b', 'separate', second);
  fs.mkdirSync(path.join(second, '.hooks'));
  fs.writeFileSync(path.join(second, '.hooks/pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  f.git(second, 'config', '--worktree', 'core.hooksPath', '.hooks');
  await f.configure(second);
  assert.throws(() => f.git(f.repo, 'config', '--get', 'core.hooksPath'));
  f.git(second, 'commit', '--allow-empty', '-m', 'only this worktree'); assert.equal(f.records().length, 1);
  await f.remove(second);
  assert.equal(f.git(second, 'config', '--worktree', '--get', 'core.hooksPath'), '.hooks');
  assert.throws(() => f.git(f.repo, 'config', '--get', 'core.hooksPath'));
});
