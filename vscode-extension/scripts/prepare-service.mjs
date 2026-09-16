import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
const directory = path.resolve("vendor/gcr-cli/0.1.0-alpha.39");
const manifest = JSON.parse(
  await readFile(path.join(directory, "manifest.json"), "utf8"),
);
const entry = manifest.packages.find((p) => p.name === "@gcr/cli");
assert.equal(entry.version, "0.1.0-alpha.39");
assert.equal(
  entry.sha256,
  "560421894593080e854ff981c5342ec789c71ba95c57301c80308e31b9bb1c87",
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
const extract = (name) => execFileSync(
  "tar", ["-xOzf", file, "package/dist/" + name],
  { maxBuffer: 4 * 1024 * 1024 },
);
const nativeBytes = extract("windows-native.exe");
const nativeManifestBytes = extract("windows-native.json");
const native = JSON.parse(nativeManifestBytes);
const hash = (value) => createHash("sha256").update(value).digest("hex");
assert.equal(native.version, "1.0.3");
assert.equal(native.sha256, hash(nativeBytes));
assert.equal(native.sourceSha256, hash(extract("windows-native.cs")));
await writeFile(path.join(output, "windows-native.exe"), nativeBytes);
await writeFile(path.join(output, "windows-native.json"), nativeManifestBytes);
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(
    {
      ...entry,
      sourceSha: manifest.sourceSha,
      clientPackages: manifest.packages.filter((p) => p.name !== "@gcr/cli"),
      native,
      bundleSha256: createHash("sha256").update(bytes).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
