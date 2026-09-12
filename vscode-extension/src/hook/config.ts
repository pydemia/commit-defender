import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ResolvedConfig } from "../config.js";
import {
  modelCredentialBinding,
  modelCredentialReference,
  parseModelCredentialReference,
  resolveModelCredential,
  saveModelCredential,
  usesModelApiKey,
  type ModelCredentialPorts,
  type ModelCredentialReference,
} from "../modelCredentials.js";

export class HookCredentialMigrationRequired extends Error {
  constructor() {
    super(
      "Migrate the model credential from Commit Defender before updating or running this hook. Existing configuration was preserved.",
    );
    this.name = "HookCredentialMigrationRequired";
  }
}
export interface HookConfigJson {
  version: 3;
  aiProvider: ResolvedConfig["aiProvider"];
  model: string;
  endpoint: string;
  apiVersion: string;
  modelCredentialRef?: ModelCredentialReference;
  codexPath: string;
  claudeCodePath: string;
  geminiCliPath: string;
  antigravityPath: string;
  maxTokens: number;
  severityLevel: ResolvedConfig["severityLevel"];
  richnessLevel: ResolvedConfig["richnessLevel"];
  locale: ResolvedConfig["locale"];
  excludePatterns: string[];
}
const failure = () =>
  new Error(
    "Hook configuration could not be confirmed or changed. Refresh before retrying.",
  );
export const hookConfigPath = (repoRoot: string) =>
  path.join(repoRoot, ".commit-defender", "hook.json");
function safeDirectory(repoRoot: string, create: boolean): string {
  const dir = path.join(fs.realpathSync(repoRoot), ".commit-defender");
  if (create) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const stat = fs.lstatSync(dir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw failure();
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === "ENOENT")
      return dir;
    throw failure();
  }
  return dir;
}
/** Read one bounded regular file without following a repository-controlled symlink. */
export function readHookConfigSnapshot(
  repoRoot: string,
): { text: string; raw: Record<string, unknown> } | undefined {
  const dir = safeDirectory(repoRoot, false);
  let fd: number;
  try {
    fd = fs.openSync(
      path.join(dir, "hook.json"),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw failure();
  }
  try {
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.size > 1_000_000 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw failure();
    const bytes = Buffer.alloc(1_000_001);
    const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length > 1_000_000) throw failure();
    const text = bytes.subarray(0, length).toString("utf8");
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw failure();
    return { text, raw: raw as Record<string, unknown> };
  } catch {
    throw failure();
  } finally {
    fs.closeSync(fd);
  }
}
export function configToHookJson(
  cfg: ResolvedConfig,
  reference?: ModelCredentialReference,
): HookConfigJson {
  if (usesModelApiKey(cfg.aiProvider) && !reference)
    throw new HookCredentialMigrationRequired();
  if (reference) {
    reference = parseModelCredentialReference(reference);
    // Reject a reference for a different destination even before the asynchronous key lookup.
    if (
      modelCredentialReference(reference.profileId, modelCredentialBinding(cfg))
        .id !== reference.id
    )
      throw failure();
  }
  return {
    version: 3,
    aiProvider: cfg.aiProvider,
    model: cfg.model,
    endpoint: cfg.endpoint,
    apiVersion: cfg.apiVersion,
    ...(reference ? { modelCredentialRef: reference } : {}),
    codexPath: cfg.codexPath,
    claudeCodePath: cfg.claudeCodePath,
    geminiCliPath: cfg.geminiCliPath,
    antigravityPath: cfg.antigravityPath,
    maxTokens: cfg.maxTokens,
    severityLevel: cfg.severityLevel,
    richnessLevel: cfg.richnessLevel,
    locale: cfg.locale,
    excludePatterns: cfg.excludePatterns,
  };
}
const providers = [
  "aoai",
  "openai",
  "anthropic",
  "gemini",
  "codex",
  "claudecode",
  "geminicli",
  "antigravity",
];
export function hookConfigSettings(
  raw: Record<string, unknown>,
): ResolvedConfig {
  const text = (name: string, fallback: string) => {
    const value = raw[name] ?? fallback;
    if (
      typeof value !== "string" ||
      value.length > 4096 ||
      value.includes("\0")
    )
      throw failure();
    return value;
  };
  const aiProvider = text("aiProvider", "aoai");
  if (!providers.includes(aiProvider)) throw failure();
  if (
    raw.excludePatterns !== undefined &&
    (!Array.isArray(raw.excludePatterns) ||
      raw.excludePatterns.length > 1000 ||
      raw.excludePatterns.some((x) => typeof x !== "string" || x.length > 4096))
  )
    throw failure();
  return {
    aiProvider: aiProvider as ResolvedConfig["aiProvider"],
    model: text("model", ""),
    endpoint: text("endpoint", ""),
    apiVersion: text("apiVersion", "2024-08-01-preview"),
    apiKey: "",
    codexPath: text("codexPath", "codex"),
    claudeCodePath: text("claudeCodePath", "claude"),
    geminiCliPath: text("geminiCliPath", "gemini"),
    antigravityPath: text("antigravityPath", "agy"),
    maxTokens:
      typeof raw.maxTokens === "number" && Number.isFinite(raw.maxTokens)
        ? raw.maxTokens
        : 4096,
    severityLevel: text(
      "severityLevel",
      "moderate",
    ) as ResolvedConfig["severityLevel"],
    richnessLevel: text(
      "richnessLevel",
      "moderate",
    ) as ResolvedConfig["richnessLevel"],
    locale: text("locale", "en") as ResolvedConfig["locale"],
    excludePatterns: (raw.excludePatterns as string[]) ?? [],
    colorPalette: "theme-adaptive",
    preCommitHook: "enable",
    fileTimeoutSeconds: 0,
    directoryTimeoutSeconds: 0,
    stagedFilesWarnThreshold: 0,
    repoAnalysisWarnThreshold: 0,
    runOnStage: false,
  };
}
/** Only reference resolution can populate an API key in a headless runtime config. */
export async function readHookRuntimeConfig(
  repoRoot: string,
  ports: ModelCredentialPorts = {},
): Promise<ResolvedConfig | null> {
  const snapshot = readHookConfigSnapshot(repoRoot);
  if (!snapshot) return null;
  const cfg = hookConfigSettings(snapshot.raw);
  if (usesModelApiKey(cfg.aiProvider)) {
    if (
      snapshot.raw.apiKey ||
      !snapshot.raw.modelCredentialRef ||
      snapshot.raw.version !== 3
    )
      throw new HookCredentialMigrationRequired();
    cfg.apiKey = await resolveModelCredential(
      snapshot.raw.modelCredentialRef,
      modelCredentialBinding(cfg),
      ports,
    );
  }
  return cfg;
}

/** Publish a complete lock directory so a crashed owner is distinguishable from an active writer. */
function acquireLock(dir: string): () => void {
  const lock = path.join(dir, ".hook-config-lock");
  const prepared = path.join(dir, `.hook-lock-${randomUUID()}`);
  const owner = JSON.stringify({
    format: 1,
    pid: process.pid,
    nonce: randomUUID(),
  });
  fs.mkdirSync(prepared, { mode: 0o700 });
  fs.writeFileSync(path.join(prepared, "owner.json"), owner, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.renameSync(prepared, lock);
        break;
      } catch (error) {
        if (
          !["ENOTEMPTY", "EEXIST"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          ) ||
          attempt
        )
          throw failure();
        const stat = fs.lstatSync(lock);
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          (process.getuid && stat.uid !== process.getuid())
        )
          throw failure();
        const entries = fs.readdirSync(lock);
        if (entries.length !== 1 || entries[0] !== "owner.json")
          throw failure();
        const ownerPath = path.join(lock, "owner.json");
        const ownerStat = fs.lstatSync(ownerPath);
        if (
          !ownerStat.isFile() ||
          ownerStat.isSymbolicLink() ||
          ownerStat.size > 1024
        )
          throw failure();
        const prior = fs.readFileSync(ownerPath, "utf8");
        const parsed = JSON.parse(prior);
        if (
          parsed.format !== 1 ||
          !Number.isSafeInteger(parsed.pid) ||
          parsed.pid <= 0 ||
          typeof parsed.nonce !== "string"
        )
          throw failure();
        try {
          process.kill(parsed.pid, 0);
          throw failure();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH")
            throw failure();
        }
        if (
          fs.lstatSync(lock).ino !== stat.ino ||
          fs.readFileSync(ownerPath, "utf8") !== prior
        )
          throw failure();
        fs.unlinkSync(ownerPath);
        fs.rmdirSync(lock);
      }
    }
  } catch {
    fs.rmSync(prepared, { recursive: true, force: true });
    throw failure();
  }
  return () => {
    if (fs.readFileSync(path.join(lock, "owner.json"), "utf8") !== owner)
      throw failure();
    fs.unlinkSync(path.join(lock, "owner.json"));
    fs.rmdirSync(lock);
  };
}
/** Atomic replacement guarded by the exact legacy snapshot and a cooperating-process lock. */
function publishConfig(
  repoRoot: string,
  cfg: HookConfigJson,
  expectedText: string | undefined,
): void {
  const dir = safeDirectory(repoRoot, true);
  const release = acquireLock(dir);
  const temporary = path.join(dir, `.hook-config-${randomUUID()}`);
  try {
    if (readHookConfigSnapshot(repoRoot)?.text !== expectedText)
      throw failure();
    const fd = fs.openSync(
      temporary,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      0o600,
    );
    try {
      fs.writeFileSync(fd, JSON.stringify(cfg, null, 2) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (readHookConfigSnapshot(repoRoot)?.text !== expectedText)
      throw failure();
    fs.renameSync(temporary, path.join(dir, "hook.json"));
    const directory = fs.openSync(dir, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
    release();
  }
}
/** Automatic mirroring never consumes or deletes a legacy plaintext credential. */
export async function writeHookConfig(
  repoRoot: string,
  cfg: ResolvedConfig,
  reference?: ModelCredentialReference,
  ports: ModelCredentialPorts = {},
): Promise<void> {
  const before = readHookConfigSnapshot(repoRoot);
  if (before?.raw.apiKey) throw new HookCredentialMigrationRequired();
  const next = configToHookJson(
    cfg,
    usesModelApiKey(cfg.aiProvider) ? reference : undefined,
  );
  if (next.modelCredentialRef)
    await resolveModelCredential(
      next.modelCredentialRef,
      modelCredentialBinding(cfg),
      ports,
    );
  publishConfig(repoRoot, next, before?.text);
}
/** An explicit migration leaves legacy bytes intact until the OS key and ciphertext have been reopened and verified. */
export async function migrateHookModelCredential(
  repoRoot: string,
  profileId: string,
  ports: ModelCredentialPorts = {},
  expectedText?: string,
): Promise<ModelCredentialReference> {
  const before = readHookConfigSnapshot(repoRoot);
  if (!before) throw failure();
  if (expectedText !== undefined && before.text !== expectedText)
    throw failure();
  const cfg = hookConfigSettings(before.raw);
  const binding = modelCredentialBinding(cfg);
  if (typeof before.raw.apiKey !== "string" || !before.raw.apiKey) {
    const ref = parseModelCredentialReference(before.raw.modelCredentialRef);
    if (ref.profileId !== profileId) throw failure();
    await resolveModelCredential(ref, binding, ports);
    return ref;
  }
  const ref = await saveModelCredential(
    profileId,
    binding,
    before.raw.apiKey,
    ports,
  );
  publishConfig(repoRoot, configToHookJson(cfg, ref), before.text);
  const verified = await readHookRuntimeConfig(repoRoot, ports);
  if (verified?.apiKey !== before.raw.apiKey) throw failure();
  return ref;
}
