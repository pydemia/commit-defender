import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.resolve('@gcr/client-core')));
const manifestBytes = await readFile(path.join(directory, 'windows-native.json'));
const manifest = JSON.parse(manifestBytes);
const executable = await readFile(path.join(directory, 'windows-native.exe'));
const source = await readFile(path.join(directory, '../native/windows/Native.cs'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function put(file, bytes) {
  try { if ((await readFile(file)).equals(bytes)) return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = file + '.' + randomUUID();
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}
assert.equal(manifest.version, '1.0.3');
assert.equal(manifest.sha256, hash(executable));
assert.equal(manifest.sourceSha256, hash(source));
for (const output of ['out', 'out-test']) {
  await mkdir(output, { recursive: true });
  await put(path.join(output, 'windows-native.exe'), executable);
  await put(path.join(output, 'windows-native.json'), manifestBytes);
}
const notices = 'third-party/gcr/client-core/native/windows';
await mkdir(notices, { recursive: true });
await put(path.join(notices, 'Native.cs'), source);
