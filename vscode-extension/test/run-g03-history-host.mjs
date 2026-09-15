import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runTests } from "@vscode/test-electron";
import {
  defaultLocalDataDirectory,
  PlatformLocalKeyStore,
} from "@gcr/client-core";
const extension = process.env.G03_EXTENSION;
assert(extension && path.isAbsolute(extension));
assert(process.env.G03_CONFIGURATION && process.env.G03_EVIDENCE);
const root = await mkdtemp(path.join(os.tmpdir(), "cd-g03-host-"));
const workspace = path.join(root, "workspace"),
  profileId = "cd-g03-" + randomUUID();
const filename =
  "data-management/mainapp/domains/position_management/block/schema.py";
const git = (...args) =>
  execFileSync(
    "git",
    [
      "-C",
      workspace,
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=G03 Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { stdio: "pipe" },
  );
try {
  await mkdir(path.dirname(path.join(workspace, filename)), {
    recursive: true,
  });
  git("init", "-b", "main");
  git(
    "remote",
    "add",
    "origin",
    "https://github.com/skccmygit/skax-successionX-backend.git",
  );
  await writeFile(
    path.join(workspace, filename),
    "from pydantic import BaseModel, Field\n\nclass BlockUpdateRequest(BaseModel):\n    name: str = Field(min_length=1)\n",
  );
  // Unchanged callers and boundary tests are fixed supporting context, not extra review targets.
  await writeFile(path.join(workspace, path.dirname(filename), "consumer.py"),
    "from .schema import BlockUpdateRequest\n\ndef update_block(payload: dict) -> dict:\n    request = BlockUpdateRequest.model_validate(payload)\n    return {\"name\": request.name}\n");
  await mkdir(path.join(workspace, "tests"));
  await writeFile(path.join(workspace, "tests/test_block_update.py"),
    "import pytest\nfrom pydantic import ValidationError\nfrom mainapp.domains.position_management.block.consumer import update_block\n\ndef test_nonempty_name_is_returned():\n    assert update_block({\"name\": \"alpha\"}) == {\"name\": \"alpha\"}\n\ndef test_empty_name_is_rejected():\n    with pytest.raises(ValidationError):\n        update_block({\"name\": \"\"})\n");
  await writeFile(path.join(workspace, "pyproject.toml"),
    '[project]\nname = "g03-validation-fixture"\nversion = "0.0.0"\ndependencies = ["pydantic>=2,<3", "pytest>=8,<9"]\n\n[tool.pytest.ini_options]\npythonpath = ["data-management"]\n');
  git("add", ".");
  git("commit", "-m", "synthetic G03 validation baseline");
  await writeFile(
    path.join(workspace, filename),
    "from pydantic import BaseModel\n\nclass BlockUpdateRequest(BaseModel):\n    name: str\n",
  );
  git("add", filename);
  await mkdir(path.join(root, "user-data/User"), { recursive: true });
  await writeFile(
    path.join(root, "user-data/User/settings.json"),
    JSON.stringify({
      "commitDefender.localProfile": profileId,
      "commitDefender.runOnStage": false,
      "commitDefender.preCommitHook": "disable",
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
    }),
  );
  await runTests({
    vscodeExecutablePath:
      "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    extensionDevelopmentPath: extension,
    extensionTestsPath: path.resolve("out-test/g03-history-host.cjs"),
    extensionTestsEnv: {
      G03_CONFIGURATION: process.env.G03_CONFIGURATION,
      G03_WORKSPACE: workspace,
      G03_PROFILE: profileId,
      G03_EVIDENCE: process.env.G03_EVIDENCE,
      ...(process.env.G03_MODEL_CONFIGURATION
        ? { G03_MODEL_CONFIGURATION: process.env.G03_MODEL_CONFIGURATION }
        : {}),
    },
    launchArgs: [
      workspace,
      "--user-data-dir",
      path.join(root, "user-data"),
      "--extensions-dir",
      path.join(root, "extensions"),
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-updates",
      "--disable-telemetry",
    ],
  });
} finally {
  const directories = [];
  const discover = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries)
      if (entry.isDirectory()) {
        const file = path.join(dir, entry.name);
        if (entry.name === profileId && path.basename(dir) === "profiles")
          directories.push(file);
        else await discover(file);
      }
  };
  await discover(defaultLocalDataDirectory());
  const refs = new Set();
  const inspect = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else if (entry.name === "key-ref.json") {
        const ref = JSON.parse(await readFile(file, "utf8"));
        assert.equal(ref.profileId, profileId);
        refs.add(`${profileId}.${ref.id}`);
      }
    }
  };
  for (const dir of directories) await inspect(dir);
  const keys = new PlatformLocalKeyStore();
  for (const ref of refs) await keys.remove(ref);
  for (const dir of directories)
    await rm(dir, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
}
