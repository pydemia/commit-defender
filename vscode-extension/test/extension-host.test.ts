import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import {
  defaultLocalDataDirectory,
  discoverLocalIdentity,
  LocalRecordStore,
  LocalHistoryStore,
  discoverCentralConnections,
  CentralConnections,
} from "@gcr/client-core";
import { centralFixture } from "./helpers/central-fixture.js";
import { knowledgeScope } from "../src/localKnowledge.js";
import { clientReviewReport } from "@gcr/client-contract";
import { centralSourcesKnowledgeHtml } from "../src/centralKnowledgeView.js";
import { checkModelSetup } from './model-setup-host.js';

/** Executed by the real VS Code Extension Host, not by a vscode module mock. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("pydemia.commit-defender");
  assert(extension, "Development extension must be installed");
  await extension.activate();
  assert(extension.isActive, "Extension activation must complete");

  const workspace = process.env.CD_TEST_WORKSPACE;
  assert(workspace);
  assert.equal(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, workspace);
  const config = vscode.workspace.getConfiguration("commitDefender");
  assert.equal(config.get("preCommitHook"), "disable");
  assert.equal(config.get("runOnStage"), false);
  assert.equal(config.get("reviewMode"), "standalone");
  assert.equal(
    config.inspect<string>("localProfile")?.globalValue,
    process.env.CD_TEST_PROFILE,
  );
  const commands = new Set(await vscode.commands.getCommands(true));
  const declared: string[] = extension.packageJSON.contributes.commands.map(
    (command: { command: string }) => command.command,
  );
  for (const command of declared)
    assert(commands.has(command), `Missing command: ${command}`);
  assert.equal(extension.packageJSON.contributes.commands.find((item: any) => item.command === 'commitDefender.selectAccountProviderAndModel').title, 'Commit Defender: Use Account');
  assert.equal(extension.packageJSON.contributes.commands.find((item: any) => item.command === 'commitDefender.manageModelCredential').title, 'Commit Defender: Use API Credential');
  assert(existsSync(path.join(extension.extensionPath, 'out', 'account-catalog-worker.js')));
  const modelSetup = process.env.CD_TEST_MODEL_SETUP === '1' ? await checkModelSetup() : undefined;
  for (const removed of [
    "commitDefender.analyzeWithExecutor",
    "commitDefender.centralModelRequests",
    "commitDefender.submitReviewFeedback",
  ])
    assert(
      !commands.has(removed),
      `One-way integration must not register ${removed}`,
    );
  await vscode.commands.executeCommand("commitDefender.clearFindings");
  await vscode.commands.executeCommand("commitDefender.cancel");
  await vscode.commands.executeCommand("commitDefender.refreshLocalHistory");
  assert(
    !existsSync(
      path.join(
        defaultLocalDataDirectory(),
        "profiles",
        process.env.CD_TEST_PROFILE!,
      ),
    ),
  );
  await vscode.commands.executeCommand("commitDefender.localReviewActivity", 7);
  const activityTabs = () =>
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.label === "Local Review Activity");
  const waitForActivity = async (count: number) => {
    for (
      let attempt = 0;
      attempt < 100 && activityTabs().length !== count;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
  };
  await waitForActivity(1);

  assert.equal(
    activityTabs().length,
    1,
    "Activity command must open the real webview",
  );
  await vscode.commands.executeCommand(
    "commitDefender.localReviewActivity",
    90,
  );
  await waitForActivity(1);
  assert.equal(
    activityTabs().length,
    1,
    "Refreshing must replace the previous view",
  );
  await vscode.commands.executeCommand("commitDefender.clearFindings");
  // Tab close events are delivered after the command resolves.
  for (let attempt = 0; attempt < 40 && activityTabs().length; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    activityTabs().length,
    0,
    "Invalidation closes the activity view",
  );
  assert(
    !existsSync(
      path.join(
        defaultLocalDataDirectory(),
        "profiles",
        process.env.CD_TEST_PROFILE!,
      ),
    ),
    "Empty activity must not create storage or an OS key",
  );
  if (process.env.CD_TEST_ACTIVITY_FIXTURE === "1") {
    const profileId = process.env.CD_TEST_PROFILE!;
    const identity = discoverLocalIdentity(workspace, profileId);
    const scope = {
      kind: "repository" as const,
      profileId,
      repositoryKey: identity.repositoryKey,
      worktreeKey: identity.worktreeKey,
    };
    const corpus = JSON.parse(
      readFileSync(
        path.resolve(
          __dirname,
          "../test/fixtures/client-contract/reports.json",
        ),
        "utf8",
      ),
    );
    const report = clientReviewReport(
      corpus.cases.find((item: { name: string }) => item.name === "clean")
        .report,
    );
    report.identity.client = {
      mode: "standalone",
      profileId,
      repositoryKey: scope.repositoryKey,
      worktreeKey: scope.worktreeKey,
    };
    report.identity.executor.model = "synthetic-observation-fixture";
    report.requestedAt = report.startedAt = new Date(
      Date.now() - 1000,
    ).toISOString();
    report.finishedAt = new Date().toISOString();
    const records = await LocalRecordStore.open({ scope });
    try {
      await new LocalHistoryStore(records).saveReview(report);
    } finally {
      records.close();
    }
    await vscode.commands.executeCommand(
      "commitDefender.localReviewActivity",
      30,
    );
    await waitForActivity(1);
    assert.equal(
      activityTabs().length,
      1,
      "Read real encrypted fixture history in the installed extension",
    );
    await vscode.commands.executeCommand("commitDefender.clearFindings");
  }
  assert(!existsSync(path.join(workspace, ".git", "hooks", "pre-commit")));

  // Exercise the URL/key discovery and existing signed connection in a real host.
  const central = await centralFixture(
    workspace,
    "PRIMARY_HOST_SOURCE",
    false,
    undefined,
    [
      {
        repositoryId: "host-reference",
        name: "helm",
        instructions: "REFERENCE_HOST_SOURCE",
      },
    ],
  );
  const centralScope = knowledgeScope({
    profileId: process.env.CD_TEST_PROFILE!,
    repoRoot: workspace,
    scope: "repository",
  });
  assert.equal(centralScope.kind, "repository");
  const manager = await CentralConnections.open({
    scope: centralScope,
    dataDirectory: path.join(workspace, ".central-test"),
    keys: central.keys,
    credentials: central.credentials,
  });
  const connectedIds: string[] = [];
  let directConnectionEvidence;
  try {
    const options = await discoverCentralConnections(
      central.config.serverUrl,
      central.secret,
      "commit-defender",
      { ca: central.config.ca },
    );
    assert.equal(options.repositories.length, 2);
    const states = [];
    const previews: Parameters<typeof centralSourcesKnowledgeHtml>[0] = [];
    for (const source of options.repositories) {
      const connected = await manager.connect(
        {
          ...central.config,
          repositoryId: source.repositoryId,
          trustedKeys: options.trustedKeys,
          ca: options.ca,
        },
        central.secret,
        "commit-defender",
        new AbortController().signal,
        { referenceOnly: true },
      );
      connectedIds.push(connected.id);
      const status = await manager.status(connected.id);
      assert.equal(status.status, "connected");
      assert.equal(status.cache.status, "ready");
      const access = await manager.review(connected.id, "online");
      const snapshot = await access.cache.read("online");
      await access.assertConnection();
      previews.push({
        snapshot,
        label: `${source.owner}/${source.name}`,
        referenceOnly: true,
      });
      states.push({
        repositoryId: source.repositoryId,
        sourceName: `${source.owner}/${source.name}`,
        snapshot: snapshot.manifest.payload.snapshotId,
        manifestHash: snapshot.manifest.manifestHash,
        referenceOnly: status.referenceOnly,
      });
    }
    const preview = vscode.window.createWebviewPanel(
      "commitDefender.testSources",
      "Downloaded review knowledge",
      vscode.ViewColumn.Active,
      { enableScripts: false, localResourceRoots: [] },
    );
    try {
      preview.webview.html = centralSourcesKnowledgeHtml(previews);
      assert(
        preview.webview.html.includes("team/reviewer") &&
          preview.webview.html.includes("team/helm"),
      );
      for (
        let attempt = 0;
        attempt < 40 &&
        !vscode.window.tabGroups.all
          .flatMap((g) => g.tabs)
          .some((t) => t.label === "Downloaded review knowledge");
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert(
        vscode.window.tabGroups.all
          .flatMap((g) => g.tabs)
          .some((t) => t.label === "Downloaded review knowledge"),
      );
    } finally {
      preview.dispose();
    }
    assert(
      central.requestMetadata.every(
        (r) => r.method === "GET" && r.bodyBytes === 0,
      ),
    );
    directConnectionEvidence = {
      discovery: "URL and masked-key flow metadata",
      signedConnection: "connected",
      cache: "ready",
      sources: states,
      requests: central.requestMetadata,
      localUploadBytes: 0,
      modelCalls: 0,
      multiSourcePreview:
        "read-only real Extension Host webview created and closed; DOM content assertion only",
      source: "owned HTTPS publisher, no production credentials",
    };
  } finally {
    for (const id of connectedIds) await manager.disconnect(id);
    manager.close();
    assert.equal(central.credentialValues.size, 0);
    await central.close();
  }
  const evidence = {
    status: "passed",
    modelSetup,
    vscode: vscode.version,
    node: process.versions.node,
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    extensionVersion: extension.packageJSON.version,
    delivery: process.env.CD_TEST_DELIVERY ?? "source-checkout",
    commandCount: declared.length,
    activation: true,
    encryptedActivityFixture: process.env.CD_TEST_ACTIVITY_FIXTURE === "1",
    hookDefault: "disable",
    modelCalled: false,
    directConnection: directConnectionEvidence,
    checks: [
      "activation",
      "command registration",
      "central executor and upstream submission commands absent",
      "clear findings",
      "cancel without run",
      "no hook installed",
      "standalone defaults and user profile",
      "empty history refresh creates no local store or OS key",
      "local activity webview opens, refreshes and closes on invalidation without creating storage",
    ],
  };
  if (process.env.CD_TEST_EVIDENCE_FILE) {
    writeFileSync(
      process.env.CD_TEST_EVIDENCE_FILE,
      JSON.stringify(evidence, null, 2) + "\n",
    );
  }
  console.log(JSON.stringify(evidence));
}
