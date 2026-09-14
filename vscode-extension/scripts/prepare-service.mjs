import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
const directory = path.resolve("vendor/gcr-cli/0.1.0-alpha.17");
const manifest = JSON.parse(
  await readFile(path.join(directory, "manifest.json"), "utf8"),
);
const entry = manifest.packages.find((p) => p.name === "@gcr/cli");
assert.equal(entry.version, "0.1.0-alpha.17");
assert.equal(
  entry.sha256,
  "7a251f18489e3d9d286aa74b93100be7f19946628743f945fcf8461d9e4580a3",
);
const file = path.join(directory, entry.file);
assert.equal(
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex"),
  entry.sha256,
);
const bytes = execFileSync("tar", ["-xOzf", file, "package/dist/main.js"], {
  maxBuffer: 4 * 1024 * 1024,
});
const output = path.resolve("out/gcr-service");
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "main.mjs"), bytes);
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(
    {
      ...entry,
      bundleSha256: createHash("sha256").update(bytes).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
