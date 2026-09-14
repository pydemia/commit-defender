import { contentHash } from "@gcr/client-core";
import type { LocalScope } from "@gcr/client-contract";
import type { SelectionStore } from "./centralConnection.js";
export interface AutomaticSettings {
  save: boolean;
  stage: boolean;
  autoSave: boolean;
  external: boolean;
  paused: boolean;
  minimumSaveIntervalMs: number;
  maximumReviewsPerHour: number;
}
export interface AutomaticOverride {
  version: 1;
  save?: boolean;
  stage?: boolean;
  autoSave?: boolean;
  external?: boolean;
  paused?: boolean;
}
export const automaticDefaults: AutomaticSettings = {
  save: false,
  stage: false,
  autoSave: false,
  external: false,
  paused: false,
  minimumSaveIntervalMs: 600000,
  maximumReviewsPerHour: 6,
};
export function automaticSettings(
  readUser: (key: string) => unknown,
  override?: unknown,
): AutomaticSettings {
  const result = { ...automaticDefaults };
  for (const [field, setting] of Object.entries({
    save: "runOnSave",
    stage: "runOnStage",
    autoSave: "reviewAutoSaves",
    external: "reviewExternalChanges",
    paused: "automaticReviewsPaused",
  })) {
    const value = readUser(setting);
    if (typeof value === "boolean") result[field as "save"] = value;
  }
  const minimum = readUser("automaticSaveIntervalSeconds"),
    maximum = readUser("automaticReviewsPerHour");
  if (
    typeof minimum === "number" &&
    Number.isInteger(minimum) &&
    minimum >= 10 &&
    minimum <= 3600
  )
    result.minimumSaveIntervalMs = minimum * 1000;
  if (
    typeof maximum === "number" &&
    Number.isInteger(maximum) &&
    maximum >= 1 &&
    maximum <= 100
  )
    result.maximumReviewsPerHour = maximum;
  if (override !== undefined) {
    if (!override || typeof override !== "object")
      return { ...result, paused: true };
    const data = override as Record<string, unknown>;
    if (
      data.version !== 1 ||
      Object.keys(data).some(
        (k) =>
          ![
            "version",
            "save",
            "stage",
            "autoSave",
            "external",
            "paused",
          ].includes(k),
      )
    )
      return { ...result, paused: true };
    for (const field of [
      "save",
      "stage",
      "autoSave",
      "external",
      "paused",
    ] as const) {
      if (data[field] === undefined) continue;
      if (typeof data[field] !== "boolean") return { ...result, paused: true };
      result[field] = data[field];
    }
  }
  if (readUser("automaticReviewsPaused") === true) result.paused = true;
  return result;
}
export function automaticSelectionKey(scope: LocalScope) {
  return `automatic-review.v1.${contentHash(scope)}`;
}
export function readAutomaticOverride(
  store: SelectionStore,
  scope: LocalScope,
) {
  return store.get<AutomaticOverride>(automaticSelectionKey(scope));
}
