import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { countedCodexLauncher } from "./helpers/counted-codex.mjs";
test("counts local catalog probes separately and preserves argument bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cd-counted-exec-"));
  try {
    const invocations = path.join(root, "call count's.txt");
    const target = path.join(root, "delegate");
    await writeFile(target, '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
      mode: 0o700,
    });
    const launcher = path.join(root, "launcher");
    await writeFile(launcher, countedCodexLauncher(target, invocations), {
      mode: 0o700,
    });
    for (const args of [
      ["--version"],
      [
        "exec",
        "-c",
        'model_provider="openai"',
        "-c",
        'model_provider="gcr_fixture"',
        "-",
      ],
      ["exec", "-c", 'model_provider="gcr_fixture"', "argument with spaces"],
      [
        "exec",
        "-c",
        'model_provider="openai"',
        "--output-schema",
        "file's name",
        "-",
      ],
    ]) {
      const stdout = execFileSync(launcher, args, { encoding: "utf8" });
      assert.equal(stdout, args.join("\n") + "\n");
    }
    assert.deepEqual((await readFile(invocations, "utf8")).trim().split("\n"), [
      "probe-exec",
      "probe-exec",
      "review-exec",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
