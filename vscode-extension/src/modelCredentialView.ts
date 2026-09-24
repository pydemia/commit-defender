import * as vscode from "vscode";
import { canonicalJson } from "@gcr/client-core";
import { getConfig } from "./config.js";
import {
  modelCredentialBinding,
  modelCredentialReference,
  modelCredentialRevision,
  ModelCredentialError,
  saveModelCredential,
  resolveModelRuntimeConfig,
  type ModelCredentialReference,
} from "./modelCredentials.js";
import { migrateSettingsModelCredential } from "./modelCredentialSettings.js";
import {
  hookConfigSettings,
  migrateHookModelCredential,
  readHookConfigSnapshot,
} from "./hook/config.js";

/** Secret input stays in the native password box; only an OS-backed reference reaches settings. */
export async function manageModelCredential(repoRoot?: string): Promise<void> {
  const settings = () => vscode.workspace.getConfiguration("commitDefender");
  const profile = () =>
    settings().inspect<string>("localProfile")?.globalValue ?? "default";
  const profileId = profile();
  const legacy = settings().inspect<string>("apiKey");
  let hook: ReturnType<typeof readHookConfigSnapshot>;
  try {
    hook = repoRoot ? readHookConfigSnapshot(repoRoot) : undefined;
  } catch {
    /* Settings operations remain available. */
  }
  type Choice = vscode.QuickPickItem & {
    operation: "enter" | "reuse" | "user" | "workspace" | "hook";
  };
  const choices: Choice[] = [
    {
      label: "Store a model API key…",
      operation: "enter",
      description:
        "Enter a key in a password box; existing plaintext settings are preserved",
    },
    {
      label: "Use a key already stored for this selection",
      operation: "reuse",
      description:
        "Reconnect the current profile, provider, endpoint and model to its verified stored key",
    },
  ];
  if (legacy?.globalValue)
    choices.push({
      label: "Migrate API key from User Settings",
      operation: "user",
      description:
        "Remove this setting after the encrypted key and reference are verified",
    });
  if (legacy?.workspaceValue)
    choices.push({
      label: "Migrate API key from Workspace Settings",
      operation: "workspace",
      description:
        "Remove this workspace value after verification; other copies are preserved",
    });
  if (hook?.raw.apiKey || hook?.raw.modelCredentialRef) {
    let detail =
      "The existing hook destination must be a supported API provider.";
    try {
      const binding = modelCredentialBinding(hookConfigSettings(hook.raw));
      detail = `${binding.provider} · ${binding.endpoint} · ${binding.model || "provider default model"}`;
    } catch {
      /* No raw configuration values or secrets in the picker. */
    }
    choices.push({
      label: "Migrate API key from this hook",
      operation: "hook",
      description:
        "Preserve other settings; replace the hook key with a verified reference",
      detail,
    });
  }
  const chosen = await vscode.window.showQuickPick(choices, {
    title: `Model API credential · ${profileId}`,
  });
  if (!chosen) return;
  try {
    if (profile() !== profileId) throw Error("Profile changed.");
    if (chosen.operation === "hook") {
      if (!repoRoot || !hook) throw Error("Hook changed.");
      await migrateHookModelCredential(repoRoot, profileId, {}, hook.text);
      void vscode.window.showInformationMessage(
        "The hook now resolves its model API key from encrypted OS-backed storage. Other plaintext copies were preserved.",
      );
      return;
    }
    const cfg = getConfig();
    const binding = modelCredentialBinding(cfg);
    const bindingKey = canonicalJson(binding);
    const isCurrent = () => {
      try {
        return (
          profile() === profileId &&
          canonicalJson(modelCredentialBinding(getConfig())) === bindingKey
        );
      } catch {
        return false;
      }
    };
    const writeReference = async (ref: ModelCredentialReference) => {
      if (!isCurrent()) throw Error("Configuration changed.");
      await settings().update(
        "modelCredentialRef",
        ref,
        vscode.ConfigurationTarget.Global,
      );
    };
    if (chosen.operation === "reuse") {
      const ref = modelCredentialReference(profileId, binding);
      await resolveModelRuntimeConfig(
        { ...cfg, modelCredentialRef: ref },
        profileId,
      );
      await writeReference(ref);
      void vscode.window.showInformationMessage(
        "Verified stored model credential selected. Existing plaintext copies were preserved.",
      );
      return;
    }
    if (chosen.operation === "enter") {
      const secret = await vscode.window.showInputBox({
        title: "Store model API key",
        prompt: `${binding.provider} · ${binding.endpoint} · ${binding.model || "provider default model"}`,
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) =>
          !value || value.length > 16_384 || /[\u0000-\u001f\u007f]/.test(value)
            ? "Enter a nonempty API key without control characters."
            : undefined,
      });
      if (secret === undefined) return;
      if (!isCurrent()) throw Error("Configuration changed.");
      let ref: ModelCredentialReference;
      try {
        ref = await saveModelCredential(profileId, binding, secret);
      } catch (error) {
        if (
          !(error instanceof ModelCredentialError) ||
          error.code !== "credential-conflict"
        )
          throw error;
        const revision = await modelCredentialRevision(profileId, binding);
        const action = await vscode.window.showWarningMessage(
          `Replace the stored key for ${binding.provider} at ${binding.endpoint} (${binding.model || "provider default model"}) in profile ${profileId}? Existing references for this destination will use the replacement.`,
          { modal: true },
          "Replace Key",
        );
        if (action !== "Replace Key") return;
        if (!isCurrent()) throw Error("Configuration changed.");
        ref = await saveModelCredential(
          profileId,
          binding,
          secret,
          {},
          revision,
        );
      }
      await writeReference(ref);
      if (
        (await resolveModelRuntimeConfig(getConfig(), profileId)).apiKey !==
        secret
      )
        throw Error("Reference was not verified.");
      void vscode.window.showInformationMessage(
        "Model API key saved and reopened successfully. Existing plaintext settings were preserved; migrate each copy when ready.",
      );
      return;
    }
    const target =
      chosen.operation === "user"
        ? vscode.ConfigurationTarget.Global
        : vscode.ConfigurationTarget.Workspace;
    const readLegacy = () => {
      const value = settings().inspect<string>("apiKey");
      return chosen.operation === "user"
        ? value?.globalValue
        : value?.workspaceValue;
    };
    const expected =
      chosen.operation === "user"
        ? legacy?.globalValue
        : legacy?.workspaceValue;
    if (!expected) throw Error("Credential changed.");
    const action = await vscode.window.showWarningMessage(
      `Migrate the ${chosen.operation === "user" ? "User" : "Workspace"} API key for ${binding.provider} at ${binding.endpoint} (${binding.model || "provider default model"})? The selected plaintext value will be removed after verification.`,
      { modal: true },
      "Migrate",
    );
    if (action !== "Migrate") return;
    await migrateSettingsModelCredential(profileId, binding, expected, {
      isCurrent,
      readLegacy,
      writeReference,
      readReference: () =>
        settings().inspect("modelCredentialRef")?.globalValue,
      removeLegacy: async () => {
        await settings().update("apiKey", undefined, target);
      },
    });
    void vscode.window.showInformationMessage(
      "The selected API key setting was migrated and removed. Other plaintext copies were preserved.",
    );
  } catch {
    void vscode.window
      .showErrorMessage(
        "Commit Defender: Model credential could not be migrated or verified. Check the selected API provider, endpoint/model, current profile and OS credential store. Refresh before retrying; other saved credentials are not overwritten.",
        "Open User Settings",
      )
      .then((action) => {
        if (action === "Open User Settings")
          return vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "@ext:pydemia.commit-defender",
          );
      });
  }
}
