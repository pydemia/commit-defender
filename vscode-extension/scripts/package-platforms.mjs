import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "package.json")));
const vsceRoot = path.join(root, "node_modules/@vscode/vsce");
assert.equal(JSON.parse(await readFile(path.join(vsceRoot, "package.json"))).version, "4.0.0");
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root, encoding: "utf8", windowsHide: true,
}).trim();
const output = path.join(root, "test-results", `packages-${manifest.version}`);
const targets = [
  "win32-arm64", "win32-x64", "darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64",
];
await mkdir(output, { recursive: true });
const files = targets.map(target => ({
  target, file: `${manifest.name}-${manifest.version}-${target}.vsix`,
}));
// Preflight every path before building anything; never overwrite a frozen VSIX.
for (const entry of [...files, { file: "manifest.json" }]) {
  const file = path.join(output, entry.file);
  try { await access(file); }
  catch (error) { if (error.code === "ENOENT") continue; throw error; }
  throw new Error(`Artifact already exists: ${file}`);
}
for (const entry of files) {
  execFileSync(process.execPath, [
    path.join(vsceRoot, "vsce"), "package", "--no-dependencies",
    "--target", entry.target, "--out", path.join(output, entry.file),
    "--baseContentUrl", `https://github.com/pydemia/commit-defender/blob/${sourceSha}/vscode-extension/`,
    "--baseImagesUrl", `https://raw.githubusercontent.com/pydemia/commit-defender/${sourceSha}/vscode-extension/`,
  ], { cwd: root, stdio: "inherit", windowsHide: true });
  const bytes = await readFile(path.join(output, entry.file));
  entry.sha256 = createHash("sha256").update(bytes).digest("hex");
  entry.bytes = bytes.length;
}
await writeFile(path.join(output, "manifest.json"), JSON.stringify({
  version: manifest.version, sourceSha, vsceVersion: "4.0.0",
  buildPlatform: process.platform, buildArch: process.arch,
  published: false, nativeExecutionImpliedByTarget: false, packages: files,
}, null, 2) + "\n", { flag: "wx" });
console.log(`Packaged candidates: ${output}`);
