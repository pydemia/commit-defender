import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { type LocalKnowledge, type LocalScope } from "@gcr/client-contract";
import { errorCode } from "@gcr/client-core";
import {
  withLocalKnowledge,
  saveKnowledgeFromEditor,
} from "./localKnowledge.js";
import { localKnowledgeHtml } from "./localKnowledgeEditor.js";

export async function showLocalKnowledge(
  context: vscode.ExtensionContext,
  scope: LocalScope,
  changed: () => Promise<void>,
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "commitDefender.localKnowledge",
    "Local Memory and Skills",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: [],
      retainContextWhenHidden: true,
    },
  );
  context.subscriptions.push(panel);
  let records: LocalKnowledge[] = [];
  let selected: LocalKnowledge | undefined;
  let createKind: LocalKnowledge["kind"] | undefined;
  let nonce = "";
  let busy = false;
  let closed = false;
  panel.onDidDispose(() => {
    closed = true;
    records = [];
    selected = undefined;
  });
  const render = (notice = "") => {
    if (closed) return;
    nonce = randomBytes(16).toString("hex");
    panel.webview.html = localKnowledgeHtml(
      nonce,
      `${scope.profileId} · ${scope.kind === "profile" ? "All repositories in this profile" : "This repository and worktree"}`,
      records,
      selected,
      createKind,
      notice,
    );
  };
  const refresh = async (notice = "") => {
    records = await withLocalKnowledge(scope, (store) => store.list());
    if (selected)
      selected = records.find((record) => record.id === selected!.id);
    render(notice);
  };
  const reportError = (error: unknown) => {
    const code = errorCode(error);
    const message =
      code === "revision-conflict"
        ? "This entry changed in another process. Refresh before editing again. Your attempted revision was not saved."
        : code === "credential-unavailable"
          ? "The OS credential store is unavailable. No plaintext fallback was used."
          : code === "commit-unknown"
            ? "Storage could not confirm this change. Refresh and verify the current revision before retrying."
            : "The operation could not be completed. Check the fields and local storage, then refresh before retrying.";
    void vscode.window.showErrorMessage(`Commit Defender: Local Memory and Skills — ${message}`);
  };
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (closed || busy || !message || typeof message !== "object") return;
    const data = message as Record<string, unknown>;
    if (data.nonce !== nonce || typeof data.action !== "string") return;
    busy = true;
    try {
      const action = data.action;
      if (action === "select") {
        selected = records.find((record) => record.id === data.id);
        createKind = undefined;
        render();
      } else if (action === "new-memory" || action === "new-skill") {
        selected = undefined;
        createKind = action === "new-memory" ? "memory" : "skill";
        render();
      } else if (action === "refresh") await refresh();
      else if (action === "save") {
        const kind = selected?.kind ?? createKind;
        if (!kind) return;
        selected = await saveKnowledgeFromEditor(
          scope,
          kind,
          data.values,
          selected,
        );
        createKind = undefined;
        await changed();
        await refresh("Saved to encrypted local storage.");
      } else if (
        ["active", "inactive", "archived"].includes(action) &&
        selected
      ) {
        const entry = selected;
        selected = await withLocalKnowledge(scope, (store) =>
          store.setState(
            entry.id,
            entry.revision,
            action as LocalKnowledge["state"],
          ),
        );
        await changed();
        await refresh();
      } else if (action === "delete" && selected) {
        const entry = selected;
        const answer = await vscode.window.showWarningMessage(
          `Delete local ${entry.kind} “${entry.title}”?`,
          { modal: true },
          "Delete",
        );
        if (answer !== "Delete") return;
        const removed = await withLocalKnowledge(scope, (store) =>
          store.remove(entry.id, entry.revision),
        );
        selected = undefined;
        await changed();
        await refresh(
          removed.cleanupPending
            ? "Deleted. Encrypted record cleanup remains pending."
            : "Deleted.",
        );
      } else if (action === "export" && selected) {
        const entry = selected;
        const uri = await vscode.window.showSaveDialog({
          title: "Export local knowledge as a new plaintext JSON file",
          filters: { JSON: ["json"] },
        });
        if (!uri || uri.scheme !== "file") return;
        await withLocalKnowledge(scope, (store) =>
          store.exportFile(entry.id, uri.fsPath),
        );
        render(
          "Exported a plaintext copy to the selected file. Existing files are never overwritten.",
        );
      } else if (action === "import") {
        const uris = await vscode.window.showOpenDialog({
          title: "Import an exported local knowledge JSON file",
          canSelectMany: false,
          filters: { JSON: ["json"] },
        });
        const uri = uris?.[0];
        if (!uri || uri.scheme !== "file") return;
        const handle = await import("node:fs/promises").then((fs) =>
          fs.open(uri.fsPath, "r"),
        );
        let text: string;
        try {
          if ((await handle.stat()).size > 1_000_000)
            throw Error("Import exceeds size limit.");
          const bytes = Buffer.alloc(1_000_001);
          const read = await handle.read(bytes, 0, bytes.length, 0);
          if (read.bytesRead > 1_000_000)
            throw Error("Import exceeds size limit.");
          text = bytes.subarray(0, read.bytesRead).toString("utf8");
        } finally {
          await handle.close();
        }
        selected = await withLocalKnowledge(scope, (store) =>
          store.importKnowledge(JSON.parse(text)),
        );
        createKind = undefined;
        await changed();
        await refresh(
          "Imported with a new ID as a candidate. Review it before activation.",
        );
      }
    } catch (error) {
      reportError(error);
    } finally {
      busy = false;
    }
  });
  try {
    await refresh();
  } catch (error) {
    render("Local storage could not be opened.");
    reportError(error);
  }
}
