import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { LocalRecordStore, type LocalKeyStore } from "@gcr/client-core";
import { fixture } from "./helpers/review-fixture.js";
import {
  MODEL_CREDENTIAL_SERVICE,
  modelCredentialBinding,
  modelCredentialDataDirectory,
  modelCredentialReference,
  parseModelCredentialReference,
  resolveModelCredential,
  saveModelCredential,
  resolveModelRuntimeConfig,
  modelCredentialRevision,
} from "../src/modelCredentials.js";
import { migrateSettingsModelCredential } from "../src/modelCredentialSettings.js";
import {
  configToHookJson,
  hookConfigPath,
  migrateHookModelCredential,
  readHookConfigSnapshot,
  readHookRuntimeConfig,
  writeHookConfig,
} from "../src/hook/config.js";

const synthetic = "synthetic-model-credential-for-local-tests";
const apiConfig = (cfg: ReturnType<typeof fixture>["cfg"]) => ({
  ...cfg,
  aiProvider: "openai" as const,
  model: "example-model",
  endpoint: "",
  apiVersion: "",
  apiKey: synthetic,
});
function setup(t: test.TestContext) {
  const f = fixture();
  t.after(f.cleanup);
  const dataDirectory = path.join(f.root, "data");
  const values = new Map<string, Buffer>();
  let reads = 0,
    writes = 0;
  const keys: LocalKeyStore = {
    async read(id) {
      reads++;
      const value = values.get(id);
      return value && Buffer.from(value);
    },
    async write(id, value) {
      writes++;
      values.set(id, Buffer.from(value));
    },
    async remove(id) {
      values.delete(id);
    },
  };
  const writeLegacy = (extra: Record<string, unknown> = {}) => {
    fs.mkdirSync(path.dirname(hookConfigPath(f.repo)), { recursive: true });
    const text =
      JSON.stringify({ ...apiConfig(f.cfg), ...extra }, null, 2) + "\n";
    fs.writeFileSync(hookConfigPath(f.repo), text, { mode: 0o600 });
    return text;
  };
  return {
    ...f,
    ports: { dataDirectory, keys },
    values,
    counters: () => ({ reads, writes }),
    writeLegacy,
  };
}
function files(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).flatMap((name) => {
    const file = path.join(root, name);
    return fs.statSync(file).isDirectory() ? files(file) : [file];
  });
}

test("model credentials have a separate encrypted directory and OS service, and reopen through the same headless API", async (t) => {
  const f = setup(t);
  const binding = modelCredentialBinding(apiConfig(f.cfg));
  assert.equal(
    MODEL_CREDENTIAL_SERVICE,
    "com.commitdefender.model-credentials.v1",
  );
  const ref = await saveModelCredential(
    "test-profile",
    binding,
    synthetic,
    f.ports,
  );
  assert.equal(
    await resolveModelCredential(
      JSON.parse(JSON.stringify(ref)),
      binding,
      f.ports,
    ),
    synthetic,
  );
  assert(f.counters().reads >= 2);
  assert(files(modelCredentialDataDirectory(f.ports)).length > 2);
  for (const file of files(f.ports.dataDirectory)) {
    assert(!fs.readFileSync(file).includes(Buffer.from(synthetic)));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  const knowledge = await LocalRecordStore.open({
    scope: { kind: "profile", profileId: ref.profileId },
    ...f.ports,
  });
  try {
    assert.equal(await knowledge.read("settings", ref.id), undefined);
  } finally {
    knowledge.close();
  }
  assert.equal(
    f.values.size,
    2,
    "Personal knowledge and model credentials must have distinct wrapping keys",
  );
});

test("provider, endpoint, deployment/model and profile changes cannot reuse a stored reference", async (t) => {
  const f = setup(t);
  const cfg = apiConfig(f.cfg);
  const binding = modelCredentialBinding(cfg);
  const ref = await saveModelCredential(
    "profile-a",
    binding,
    synthetic,
    f.ports,
  );
  for (const altered of [
    { ...cfg, aiProvider: "anthropic" as const },
    { ...cfg, endpoint: "https://different.example/v1" },
    { ...cfg, model: "other-model" },
  ])
    await assert.rejects(
      resolveModelCredential(ref, modelCredentialBinding(altered), f.ports),
      /reference does not match/,
    );
  const before = f.counters();
  await assert.rejects(
    resolveModelCredential(
      { ...ref, profileId: "profile-b" },
      binding,
      f.ports,
    ),
    /could not be verified/,
  );
  assert.equal(f.counters().writes, before.writes);
  assert(
    !fs.existsSync(
      path.join(modelCredentialDataDirectory(f.ports), "profiles", "profile-b"),
    ),
  );
  for (const endpoint of [
    "https://user:password@example.com",
    "http://public.example",
    "https://example.com/?key=secret",
    "https://example.com/#fragment",
  ]) {
    assert.throws(
      () => modelCredentialBinding({ ...cfg, endpoint }),
      /reference does not match/,
    );
  }
  assert.equal(
    modelCredentialBinding({ ...cfg, endpoint: "http://127.0.0.1:1234/v1/" })
      .endpoint,
    "http://127.0.0.1:1234/v1",
  );
});

test("idempotent migration resumes without duplicates and refuses a different saved key", async (t) => {
  const f = setup(t);
  const binding = modelCredentialBinding(apiConfig(f.cfg));
  const first = await saveModelCredential("test", binding, synthetic, f.ports);
  assert.deepEqual(
    await saveModelCredential("test", binding, synthetic, f.ports),
    first,
  );
  await assert.rejects(
    saveModelCredential("test", binding, "different-synthetic-key", f.ports),
    /different model credential/,
  );
  assert.equal(
    await resolveModelCredential(first, binding, f.ports),
    synthetic,
  );
  const store = await LocalRecordStore.open({
    scope: { kind: "profile", profileId: "test" },
    dataDirectory: modelCredentialDataDirectory(f.ports),
    keys: f.ports.keys,
  });
  try {
    assert.deepEqual(await store.listIds("settings"), [first.id]);
    assert.equal((await store.read("settings", first.id))?.revision, 1);
  } finally {
    store.close();
  }
});

test("automatic hook writes never copy an API key or overwrite legacy plaintext", async (t) => {
  const f = setup(t);
  const cfg = apiConfig(f.cfg);
  const before = f.writeLegacy();
  const ref = await saveModelCredential(
    "test",
    modelCredentialBinding(cfg),
    synthetic,
    f.ports,
  );
  const json = configToHookJson(cfg, ref);
  assert(!Object.hasOwn(json, "apiKey"));
  assert(!JSON.stringify(json).includes(synthetic));
  await assert.rejects(
    writeHookConfig(f.repo, cfg, ref, f.ports),
    /Migrate the model credential/,
  );
  assert.equal(fs.readFileSync(hookConfigPath(f.repo), "utf8"), before);
  await assert.rejects(
    readHookRuntimeConfig(f.repo, f.ports),
    /Migrate the model credential/,
  );
});

test("explicit hook migration replaces plaintext only after verification and headless resolution uses the same credential", async (t) => {
  const f = setup(t);
  f.writeLegacy();
  const ref = await migrateHookModelCredential(f.repo, "test", f.ports);
  const raw = readHookConfigSnapshot(f.repo)!.raw;
  assert.equal(raw.version, 3);
  assert(!Object.hasOwn(raw, "apiKey"));
  assert.deepEqual(raw.modelCredentialRef, ref);
  assert.equal(fs.statSync(hookConfigPath(f.repo)).mode & 0o777, 0o600);
  const reopened = await readHookRuntimeConfig(f.repo, f.ports);
  assert.equal(reopened?.apiKey, synthetic);
  assert.equal(reopened?.model, apiConfig(f.cfg).model);
  assert.deepEqual(
    await migrateHookModelCredential(f.repo, "test", f.ports),
    ref,
  );
  const changed = { ...raw, endpoint: "https://attacker.example/v1" };
  fs.writeFileSync(hookConfigPath(f.repo), JSON.stringify(changed));
  await assert.rejects(
    readHookRuntimeConfig(f.repo, f.ports),
    /reference does not match/,
  );
});

test("OS store failure preserves the original hook and no plaintext fallback is written", async (t) => {
  const f = setup(t);
  const before = f.writeLegacy();
  const keys: LocalKeyStore = {
    async read() {
      throw Error(synthetic);
    },
    async write() {
      throw Error(synthetic);
    },
    async remove() {},
  };
  await assert.rejects(
    migrateHookModelCredential(f.repo, "test", { ...f.ports, keys }),
    (error) => {
      assert(error instanceof Error);
      assert(!error.message.includes(synthetic));
      return /could not be verified/.test(error.message);
    },
  );
  assert.equal(fs.readFileSync(hookConfigPath(f.repo), "utf8"), before);
  for (const file of files(f.ports.dataDirectory))
    assert(!fs.readFileSync(file).includes(Buffer.from(synthetic)));
});

test("a migration interrupted after vault save resumes and a concurrent hook edit is preserved", async (t) => {
  const f = setup(t);
  const before = f.writeLegacy();
  const binding = modelCredentialBinding(apiConfig(f.cfg));
  // Represents an interruption after verified vault save and before replacing legacy settings.
  await saveModelCredential("test", binding, synthetic, f.ports);
  assert.equal(fs.readFileSync(hookConfigPath(f.repo), "utf8"), before);
  let edited = false;
  let changed = "";
  const keys: LocalKeyStore = {
    ...f.ports.keys,
    async read(id) {
      if (!edited) {
        edited = true;
        changed = f.writeLegacy({ maxTokens: 8192 });
      }
      return f.ports.keys.read(id);
    },
  };
  await assert.rejects(
    migrateHookModelCredential(f.repo, "test", { ...f.ports, keys }),
    /could not be confirmed or changed/,
  );
  assert.equal(fs.readFileSync(hookConfigPath(f.repo), "utf8"), changed);
  await migrateHookModelCredential(f.repo, "test", f.ports);
  assert.equal((await readHookRuntimeConfig(f.repo, f.ports))?.maxTokens, 8192);
});

test("new hook configs contain references only and account hooks need no model key", async (t) => {
  const f = setup(t);
  const cfg = apiConfig(f.cfg);
  await assert.rejects(
    writeHookConfig(f.repo, cfg, undefined, f.ports),
    /Migrate the model credential/,
  );
  assert(!fs.existsSync(hookConfigPath(f.repo)));
  const ref = await saveModelCredential(
    "test",
    modelCredentialBinding(cfg),
    synthetic,
    f.ports,
  );
  await writeHookConfig(f.repo, cfg, ref, f.ports);
  assert(!fs.readFileSync(hookConfigPath(f.repo), "utf8").includes(synthetic));
  await writeHookConfig(
    f.repo,
    { ...cfg, aiProvider: "codex" },
    undefined,
    f.ports,
  );
  assert.equal((await readHookRuntimeConfig(f.repo, f.ports))?.apiKey, "");
  assert(
    !Object.hasOwn(readHookConfigSnapshot(f.repo)!.raw, "modelCredentialRef"),
  );
});

test("malformed references and symlink hook paths cannot redirect credential migration", async (t) => {
  const f = setup(t);
  const binding = modelCredentialBinding(apiConfig(f.cfg));
  for (const value of [
    { version: 1, profileId: "../escape", id: "0".repeat(64) },
    { ...modelCredentialReference("test", binding), secret: synthetic },
    { version: 1, profileId: "test", id: "../../escape" },
  ])
    assert.throws(
      () => parseModelCredentialReference(value),
      /reference does not match/,
    );
  const target = path.join(f.root, "external.json");
  fs.writeFileSync(target, JSON.stringify(apiConfig(f.cfg)));
  fs.mkdirSync(path.dirname(hookConfigPath(f.repo)), { recursive: true });
  fs.symlinkSync(target, hookConfigPath(f.repo));
  await assert.rejects(
    migrateHookModelCredential(f.repo, "test", f.ports),
    /could not be confirmed or changed/,
  );
  assert(fs.readFileSync(target, "utf8").includes(synthetic));
  assert.equal(f.counters().writes, 0);
});

test("settings migration removes only the selected verified value and the extension resolves it without a plaintext fallback", async (t) => {
  const f = setup(t);
  const cfg = apiConfig(f.cfg);
  const binding = modelCredentialBinding(cfg);
  let legacy: string | undefined = synthetic;
  let reference: unknown;
  let removed = false;
  const ref = await migrateSettingsModelCredential(
    "test",
    binding,
    synthetic,
    {
      isCurrent: () => true,
      readLegacy: () => legacy,
      readReference: () => reference,
      writeReference: async (value) => {
        reference = JSON.parse(JSON.stringify(value));
      },
      removeLegacy: async () => {
        assert.equal(
          await resolveModelCredential(reference, binding, f.ports),
          synthetic,
        );
        removed = true;
        legacy = undefined;
      },
    },
    f.ports,
  );
  assert(removed);
  assert.equal(legacy, undefined);
  assert.equal(
    (
      await resolveModelRuntimeConfig(
        { ...cfg, apiKey: "stale-plaintext", modelCredentialRef: ref },
        "test",
        f.ports,
      )
    ).apiKey,
    synthetic,
  );
  await assert.rejects(
    resolveModelRuntimeConfig(
      { ...cfg, modelCredentialRef: ref },
      "other-profile",
      f.ports,
    ),
    /could not be verified/,
  );
  await assert.rejects(
    resolveModelRuntimeConfig(cfg, "test", f.ports),
    /could not be verified/,
  );
});

test("interrupted or concurrently changed settings retain their legacy value and can resume with the verified reference", async (t) => {
  const f = setup(t);
  const cfg = apiConfig(f.cfg);
  const binding = modelCredentialBinding(cfg);
  let legacy: string | undefined = synthetic;
  let reference: unknown;
  let interrupt = true;
  let removals = 0;
  const port = {
    isCurrent: () => true,
    readLegacy: () => legacy,
    readReference: () => reference,
    writeReference: async (value: unknown) => {
      reference = value;
      if (interrupt) throw Error("simulated settings write interruption");
    },
    removeLegacy: async () => {
      removals++;
      legacy = undefined;
    },
  };
  await assert.rejects(
    migrateSettingsModelCredential("test", binding, synthetic, port, f.ports),
    /interruption/,
  );
  assert.equal(legacy, synthetic);
  assert.equal(removals, 0);
  interrupt = false;
  await assert.rejects(
    migrateSettingsModelCredential(
      "test",
      binding,
      synthetic,
      {
        ...port,
        writeReference: async (value) => {
          reference = value;
          legacy = "concurrent-new-value";
        },
      },
      f.ports,
    ),
    /different model credential/,
  );
  assert.equal(legacy, "concurrent-new-value");
  assert.equal(removals, 0);
  legacy = synthetic;
  await migrateSettingsModelCredential(
    "test",
    binding,
    synthetic,
    port,
    f.ports,
  );
  assert.equal(removals, 1);
  assert.equal(legacy, undefined);
});

test("a crashed hook writer can be recovered but an active writer's configuration and lock are preserved", async (t) => {
  const f = setup(t);
  const before = f.writeLegacy();
  const lock = path.join(f.repo, ".commit-defender/.hook-config-lock");
  fs.mkdirSync(lock, { mode: 0o700 });
  const ownerFile = path.join(lock, "owner.json");
  const active = JSON.stringify({
    format: 1,
    pid: process.pid,
    nonce: "active-test-owner",
  });
  fs.writeFileSync(ownerFile, active, { mode: 0o600 });
  await assert.rejects(
    migrateHookModelCredential(f.repo, "test", f.ports),
    /could not be confirmed or changed/,
  );
  assert.equal(fs.readFileSync(ownerFile, "utf8"), active);
  assert.equal(fs.readFileSync(hookConfigPath(f.repo), "utf8"), before);
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "ignore",
  });
  assert.equal(child.status, 0);
  assert(child.pid > 0);
  fs.writeFileSync(
    ownerFile,
    JSON.stringify({ format: 1, pid: child.pid, nonce: "exited-test-owner" }),
  );
  await migrateHookModelCredential(f.repo, "test", f.ports);
  assert(!fs.existsSync(lock));
  assert.equal(
    (await readHookRuntimeConfig(f.repo, f.ports))?.apiKey,
    synthetic,
  );
});

test("explicit key replacement checks the approved revision and preserves a concurrent replacement", async (t) => {
  const f = setup(t);
  const binding = modelCredentialBinding(apiConfig(f.cfg));
  const ref = await saveModelCredential("test", binding, synthetic, f.ports);
  const approved = await modelCredentialRevision("test", binding, f.ports);
  assert.equal(approved, 1);
  assert.deepEqual(
    await saveModelCredential(
      "test",
      binding,
      "replacement-synthetic-key",
      f.ports,
      approved,
    ),
    ref,
  );
  assert.equal(await modelCredentialRevision("test", binding, f.ports), 2);
  await assert.rejects(
    saveModelCredential(
      "test",
      binding,
      "stale-replacement-key",
      f.ports,
      approved,
    ),
    /different model credential/,
  );
  assert.equal(
    await resolveModelCredential(ref, binding, f.ports),
    "replacement-synthetic-key",
  );
});
