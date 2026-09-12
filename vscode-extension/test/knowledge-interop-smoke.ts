/** Manual OS-store/CLI/extension-editor checkpoint. Synthetic data, no model calls. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultLocalDataDirectory, errorCode } from "@gcr/client-core";
import type { LocalScope } from "@gcr/client-contract";
import {
  saveKnowledgeFromEditor,
  withLocalKnowledge,
} from "../src/localKnowledge.js";

async function main(): Promise<void> {
  const cliPath = process.env.CD_SMOKE_CLI_PATH;
  const evidencePath = process.env.CD_KNOWLEDGE_EVIDENCE;
  assert(cliPath && path.isAbsolute(cliPath));
  assert(evidencePath && path.isAbsolute(evidencePath));
  assert.equal(process.platform, "darwin");
  fs.writeFileSync(evidencePath, "", { flag: "wx", mode: 0o600 });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cd-knowledge-smoke-"));
  const profileId = `cd-knowledge-${randomUUID()}`;
  const profileDirectory = path.join(
    defaultLocalDataDirectory(),
    "profiles",
    profileId,
  );
  assert(!fs.existsSync(profileDirectory));
  const scope: LocalScope = { kind: "profile", profileId };
  const evidence: Record<string, unknown> = {
    status: "running",
    startedAt: new Date().toISOString(),
    runtime: process.version,
    modelCalls: 0,
    scope: "profile",
    credentialStore: "macOS Keychain",
    data: "synthetic",
    observations: [],
  };
  const checkpoint = () =>
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", {
      mode: 0o600,
    });
  const cli = (args: string[], input?: string) => {
    const text = execFileSync(
      process.execPath,
      [cliPath, "skill", ...args, "--scope", "profile", "--profile", profileId],
      {
        cwd: root,
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30_000,
      },
    );
    return JSON.parse(text);
  };
  try {
    checkpoint();
    const values = {
      title: "Synthetic boundary review",
      body: "Inspect captured callers and counter-evidence.",
      paths: "",
      languages: "",
      symbols: "",
      branches: "",
      rationale: "",
      counterEvidence: "",
      expiresAt: "",
    };
    const created = await saveKnowledgeFromEditor(scope, "skill", values);
    assert.equal(created.state, "candidate");
    assert(
      created.kind === "skill" &&
        created.reviewOnly &&
        created.origin === "user-authored",
    );
    assert.deepEqual(cli(["show", created.id]), created);
    (evidence.observations as string[]).push(
      "Editor-created candidate is identical in a fresh CLI process.",
    );
    const active = cli(["activate", created.id, "--revision", "1"]);
    assert.equal(active.state, "active");
    assert.deepEqual(
      await withLocalKnowledge(scope, (store) => store.get(created.id)),
      active,
    );
    await assert.rejects(
      saveKnowledgeFromEditor(
        scope,
        "skill",
        { ...values, title: "stale edit" },
        created,
      ),
      (error) => errorCode(error) === "revision-conflict",
    );
    assert.deepEqual(cli(["show", created.id]), active);
    (evidence.observations as string[]).push(
      "CLI activation is visible to a reopened editor store; stale editor revision is rejected without overwriting it.",
    );
    const edited = await saveKnowledgeFromEditor(
      scope,
      "skill",
      { ...values, title: "Updated boundary review" },
      active,
    );
    assert.equal(edited.revision, 3);
    assert.deepEqual(cli(["show", created.id]), edited);
    const exportedFile = path.join(root, "exported-skill.json");
    await withLocalKnowledge(scope, (store) =>
      store.exportFile(edited.id, exportedFile),
    );
    assert.equal(fs.statSync(exportedFile).mode & 0o777, 0o600);
    const exportedBytes = fs.readFileSync(exportedFile);
    await assert.rejects(
      withLocalKnowledge(scope, (store) =>
        store.exportFile(edited.id, exportedFile),
      ),
    );
    assert.deepEqual(fs.readFileSync(exportedFile), exportedBytes);
    const imported = cli(["import", "--input", exportedFile]);
    assert.notEqual(imported.id, edited.id);
    assert.equal(imported.state, "candidate");
    assert.equal(imported.body, edited.body);
    assert.deepEqual(
      await withLocalKnowledge(scope, (store) => store.get(imported.id)),
      imported,
    );
    (evidence.observations as string[]).push(
      "Updated editor revision is identical in CLI; 0600 export does not overwrite; CLI import creates a distinct candidate visible to the editor store.",
    );
    const inactive = cli(["deactivate", edited.id, "--revision", "3"]);
    assert.equal(inactive.state, "inactive");
    await withLocalKnowledge(scope, (store) =>
      store.remove(edited.id, inactive.revision),
    );
    assert(
      !cli(["list"]).some((item: { id: string }) => item.id === edited.id),
    );
    cli(["delete", imported.id, "--revision", "1"]);
    assert.deepEqual(
      await withLocalKnowledge(scope, (store) => store.list()),
      [],
    );
    (evidence.observations as string[]).push(
      "Deactivation and deletion propagate in both directions after reopening the stores.",
    );
    evidence.status = "verified";
  } catch (error) {
    evidence.status = "failed";
    evidence.failure =
      error instanceof Error
        ? error.message.slice(0, 1000)
        : "Knowledge checkpoint failed.";
    process.exitCode = 1;
  } finally {
    const referenceFile = path.join(profileDirectory, "local/key-ref.json");
    if (fs.existsSync(referenceFile)) {
      const reference = JSON.parse(fs.readFileSync(referenceFile, "utf8"));
      assert.equal(reference.profileId, profileId);
      assert.match(reference.id, /^[a-f0-9-]{36}$/);
      const args = [
        "-a",
        `${profileId}.${reference.id}`,
        "-s",
        "com.commitdefender.local-knowledge.v1",
      ];
      execFileSync("/usr/bin/security", ["delete-generic-password", ...args], {
        stdio: "pipe",
      });
      let absent = false;
      try {
        execFileSync("/usr/bin/security", ["find-generic-password", ...args], {
          stdio: "pipe",
        });
      } catch (error) {
        absent = (error as { status: number }).status === 44;
      }
      assert(absent);
    }
    fs.rmSync(profileDirectory, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    evidence.cleanup = "completed";
    evidence.finishedAt = new Date().toISOString();
    checkpoint();
    process.stdout.write(
      `Knowledge checkpoint ${evidence.status}; cleanup completed.\n`,
    );
  }
}
void main().catch(() => {
  process.stderr.write(
    "Knowledge checkpoint setup or cleanup failed; inspect the evidence before retrying.\n",
  );
  process.exitCode = 1;
});
