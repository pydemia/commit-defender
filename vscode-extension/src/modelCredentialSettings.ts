import { canonicalJson } from "@gcr/client-core";
import {
  ModelCredentialError,
  saveModelCredential,
  resolveModelCredential,
  type ModelCredentialBinding,
  type ModelCredentialReference,
  type ModelCredentialPorts,
} from "./modelCredentials.js";

export interface CredentialSettingsPort {
  isCurrent(): boolean;
  readReference(): unknown;
  writeReference(reference: ModelCredentialReference): Promise<void>;
  readLegacy(): string | undefined;
  removeLegacy(): Promise<void>;
}
/** Called only after the user selects a concrete legacy settings source to migrate. */
export async function migrateSettingsModelCredential(
  profileId: string,
  binding: ModelCredentialBinding,
  expectedSecret: string,
  settings: CredentialSettingsPort,
  ports: ModelCredentialPorts = {},
): Promise<ModelCredentialReference> {
  const unchanged = () =>
    settings.isCurrent() && settings.readLegacy() === expectedSecret;
  if (!unchanged()) throw new ModelCredentialError("credential-conflict");
  const reference = await saveModelCredential(
    profileId,
    binding,
    expectedSecret,
    ports,
  );
  if (!unchanged()) throw new ModelCredentialError("credential-conflict");
  await settings.writeReference(reference);
  if (
    canonicalJson(settings.readReference()) !== canonicalJson(reference) ||
    (await resolveModelCredential(reference, binding, ports)) !==
      expectedSecret ||
    !unchanged()
  )
    throw new ModelCredentialError("credential-conflict");
  await settings.removeLegacy();
  if (settings.readLegacy() !== undefined && settings.readLegacy() !== "")
    throw new ModelCredentialError("credential-conflict");
  return reference;
}
