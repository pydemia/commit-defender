import { API_DEFAULT_ENDPOINTS } from "./ai/apiEndpoints.js";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { localScope } from "@gcr/client-contract";
import {
  canonicalJson,
  contentHash,
  defaultLocalDataDirectory,
  LocalRecordStore,
  PlatformLocalKeyStore,
  type LocalKeyStore,
  type LocalRecord,
} from "@gcr/client-core";
import type { ResolvedConfig } from "./config.js";

export const MODEL_CREDENTIAL_SERVICE =
  "com.commitdefender.model-credentials.v1";
export type ApiProvider = "aoai" | "openai" | "anthropic" | "gemini";
export interface ModelCredentialBinding {
  provider: ApiProvider;
  endpoint: string;
  model: string;
  apiVersion: string;
}
export interface ModelCredentialReference {
  version: 1;
  profileId: string;
  id: string;
}
export interface ModelCredentialPorts {
  /** Trusted application/test ports. Never populated from repository configuration. */
  dataDirectory?: string;
  keys?: LocalKeyStore;
}
type CredentialErrorCode =
  | "invalid-credential-config"
  | "credential-unavailable"
  | "credential-conflict";
export class ModelCredentialError extends Error {
  constructor(readonly code: CredentialErrorCode) {
    super(
      code === "credential-conflict"
        ? "A different model credential is already stored for this destination. Existing credentials were preserved."
        : code === "invalid-credential-config"
          ? "The model credential reference does not match the selected provider, endpoint or model."
          : "The model credential could not be verified in the OS-backed store. Check the stored revision before retrying.",
    );
    this.name = "ModelCredentialError";
  }
}
const invalid = () => new ModelCredentialError("invalid-credential-config");
const unavailable = () => new ModelCredentialError("credential-unavailable");
export function usesModelApiKey(provider: string): provider is ApiProvider {
  return ["aoai", "openai", "anthropic", "gemini"].includes(provider);
}
function boundedText(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= limit &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
/** Bind a secret to every configuration field that selects its API destination. */
export function modelCredentialBinding(
  config: Pick<
    ResolvedConfig,
    "aiProvider" | "endpoint" | "model" | "apiVersion"
  >,
): ModelCredentialBinding {
  if (
    !usesModelApiKey(config.aiProvider) ||
    !boundedText(config.endpoint, 4096) ||
    !boundedText(config.model, 512) ||
    !boundedText(config.apiVersion, 128)
  )
    throw invalid();
  const raw =
    config.endpoint ||
    (config.aiProvider === "aoai"
      ? ""
      : API_DEFAULT_ENDPOINTS[config.aiProvider]);
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw invalid();
  }
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== "https:" &&
      !(
        endpoint.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
      ))
  )
    throw invalid();
  return {
    provider: config.aiProvider,
    endpoint: endpoint.toString().replace(/\/+$/, ""),
    model: config.model,
    apiVersion:
      config.aiProvider === "aoai"
        ? config.apiVersion || "2024-08-01-preview"
        : "",
  };
}
function profileScope(profileId: string) {
  try {
    return localScope({ kind: "profile", profileId });
  } catch {
    throw invalid();
  }
}
/** Deterministic public binding identity makes an interrupted migration resumable without a secret journal. */
export function modelCredentialReference(
  profileId: string,
  binding: ModelCredentialBinding,
): ModelCredentialReference {
  profileScope(profileId);
  const normalized = modelCredentialBinding({
    aiProvider: binding.provider,
    ...binding,
  });
  if (canonicalJson(normalized) !== canonicalJson(binding)) throw invalid();
  return {
    version: 1,
    profileId,
    id: contentHash({ purpose: MODEL_CREDENTIAL_SERVICE, binding }),
  };
}
export function parseModelCredentialReference(
  value: unknown,
): ModelCredentialReference {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).sort().join(",") !== "id,profileId,version" ||
    r.version !== 1 ||
    typeof r.profileId !== "string" ||
    typeof r.id !== "string" ||
    !/^[a-f0-9]{64}$/.test(r.id)
  )
    throw invalid();
  profileScope(r.profileId);
  return { version: 1, profileId: r.profileId, id: r.id };
}
function checkedReference(
  value: unknown,
  binding: ModelCredentialBinding,
): ModelCredentialReference {
  const reference = parseModelCredentialReference(value);
  if (
    canonicalJson(reference) !==
    canonicalJson(modelCredentialReference(reference.profileId, binding))
  )
    throw invalid();
  return reference;
}
export function modelCredentialDataDirectory(
  ports: ModelCredentialPorts = {},
): string {
  return path.join(
    ports.dataDirectory ?? defaultLocalDataDirectory(),
    "model-credentials",
    "v1",
  );
}
async function openStore(
  reference: ModelCredentialReference,
  create: boolean,
  ports: ModelCredentialPorts,
) {
  const dataDirectory = modelCredentialDataDirectory(ports);
  if (!create) {
    // Resolving a saved reference must not create a replacement key for missing data.
    const file = path.join(
      dataDirectory,
      "profiles",
      reference.profileId,
      "local",
      "key-ref.json",
    );
    try {
      await lstat(file);
    } catch {
      throw unavailable();
    }
  }
  return LocalRecordStore.open({
    scope: profileScope(reference.profileId),
    dataDirectory,
    keys: ports.keys ?? new PlatformLocalKeyStore(MODEL_CREDENTIAL_SERVICE),
  });
}
function recordValue(
  record: LocalRecord | undefined,
  binding: ModelCredentialBinding,
): string | undefined {
  if (!record || record.deleted) return undefined;
  const value = record.value as Record<string, unknown>;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "binding,formatVersion,kind,secret" ||
    value.formatVersion !== 1 ||
    value.kind !== "model-api-key" ||
    canonicalJson(value.binding) !== canonicalJson(binding) ||
    !boundedText(value.secret, 16_384) ||
    !value.secret.length
  )
    throw unavailable();
  return value.secret;
}
export async function resolveModelCredential(
  referenceValue: unknown,
  binding: ModelCredentialBinding,
  ports: ModelCredentialPorts = {},
): Promise<string> {
  const reference = checkedReference(referenceValue, binding);
  try {
    const store = await openStore(reference, false, ports);
    try {
      const secret = recordValue(
        await store.read("settings", reference.id),
        binding,
      );
      if (!secret) throw unavailable();
      return secret;
    } finally {
      store.close();
    }
  } catch {
    throw unavailable();
  }
}

/** Metadata for an explicit replacement prompt. No secret value is returned to the UI. */
export async function modelCredentialRevision(
  profileId: string,
  binding: ModelCredentialBinding,
  ports: ModelCredentialPorts = {},
): Promise<number> {
  const ref = modelCredentialReference(profileId, binding);
  try {
    const store = await openStore(ref, false, ports);
    try {
      const record = await store.read("settings", ref.id);
      if (!recordValue(record, binding) || !record) throw unavailable();
      return record.revision;
    } finally {
      store.close();
    }
  } catch {
    throw unavailable();
  }
}
/** Explicit save/migration only. A different existing value is preserved unless its revision was approved. */
export async function saveModelCredential(
  profileId: string,
  binding: ModelCredentialBinding,
  secret: string,
  ports: ModelCredentialPorts = {},
  replaceRevision?: number,
): Promise<ModelCredentialReference> {
  const reference = modelCredentialReference(profileId, binding);
  if (!boundedText(secret, 16_384) || !secret.length) throw invalid();
  try {
    const store = await openStore(reference, true, ports);
    try {
      const existing = await store.read("settings", reference.id);
      const previous = recordValue(existing, binding);
      if (previous !== secret) {
        if (previous !== undefined && replaceRevision !== existing?.revision)
          throw new ModelCredentialError("credential-conflict");
        if (
          replaceRevision !== undefined &&
          replaceRevision !== (existing?.revision ?? 0)
        )
          throw new ModelCredentialError("credential-conflict");
        await store.write(
          "settings",
          reference.id,
          {
            formatVersion: 1,
            kind: "model-api-key",
            binding,
            secret,
          },
          existing?.revision ?? 0,
        );
      }
    } finally {
      store.close();
    }
    // Reopen both the encrypted record and OS wrapping key before a caller may remove legacy plaintext.
    if ((await resolveModelCredential(reference, binding, ports)) !== secret)
      throw unavailable();
    return reference;
  } catch (error) {
    if (error instanceof ModelCredentialError) throw error;
    throw unavailable();
  }
}

/** Extension and headless adapters resolve secrets immediately before constructing an API request. */
export async function resolveModelRuntimeConfig(
  cfg: ResolvedConfig,
  profileId: string,
  ports: ModelCredentialPorts = {},
): Promise<ResolvedConfig> {
  if (!usesModelApiKey(cfg.aiProvider)) return { ...cfg, apiKey: "" };
  if (
    !cfg.modelCredentialRef ||
    parseModelCredentialReference(cfg.modelCredentialRef).profileId !==
      profileId
  )
    throw unavailable();
  return {
    ...cfg,
    apiKey: await resolveModelCredential(
      cfg.modelCredentialRef,
      modelCredentialBinding(cfg),
      ports,
    ),
  };
}
