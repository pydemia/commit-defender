import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The unchanged helper was built and tested on Windows. Reuse its frozen bytes
// when the current JavaScript packages were built on macOS without .NET.
export async function windowsNativeArtifact() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const archive = path.join(root, 'vendor/gcr/0.1.0-alpha.49/gcr-client-core-0.1.0-alpha.49.tgz');
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(await readFile(archive)), '0471d3f34a10a4c1badb7e6e8586bf6bb16f33308b15a117a71ad647b7a25be4');
  const extract = (file) => execFileSync('tar', ['-xOzf', archive, 'package/' + file], { maxBuffer: 4 * 1024 * 1024 });
  const executable = extract('dist/windows-native.exe');
  const manifestBytes = extract('dist/windows-native.json');
  const source = extract('native/windows/Native.cs');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.version, '1.0.3');
  assert.equal(manifest.sha256, hash(executable));
  assert.equal(manifest.sourceSha256, hash(source));
  const current = path.dirname(fileURLToPath(import.meta.resolve('@gcr/client-core')));
  assert.deepEqual(source, await readFile(path.join(current, '../native/windows/Native.cs')), 'Changed helper source requires a new Windows build');
  return { executable, manifestBytes, manifest, source };
}
