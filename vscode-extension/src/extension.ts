import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { reviewStatus } from './reviewOutcome.js';
import { SummaryView } from './summaryView.js';
import { reviewNavigation } from './reviewNavigation.js';
import { liveBlocks, liveSource, retainCapturedSources } from './reviewSource.js';
import { createReviewBackend, createLegacyReviewBackend } from './reviewBackend.js';
import { ReviewExecutionOwner } from './reviewExecution.js';
import { checkLocalContextFreshness, knowledgeScope, readLocalHistory } from './localKnowledge.js';
import { showLocalKnowledge } from './localKnowledgeView.js';
import { AccountProvider } from './ai/providers.js';
import { SuggestionCodeLensProvider } from './codeLens.js';
import { CommentManager } from './comments.js';
import { ExtensionConfig, getConfig, getStandaloneReviewSettings } from './config.js';
import { applyDiagnostics } from './diagnostics.js';
import { findingsStore } from './findingsStore.js';
import { collectFiles, getRepoRoot, getStagedFiles } from './gitHelper.js';
import type { SourceExclusion } from './sourcePolicy.js';
import { HistoryProvider, AnalysisScope } from './historyProvider.js';
import { hookIsInstalled, installHook, uninstallHook, writeHookConfig } from './hook/install.js';
import { PanelProvider } from './panelProvider.js';
import { getOutputChannel, disposeOutputChannel } from './outputChannel.js';
import { StatusBarManager } from './statusBar.js';
import { AnalysisReport, CommitMessageResult, RunResult } from './types.js';
import { resolvePalette } from './palette.js';
import { normalizeReport } from './commentFormatter.js';

const ALL_FILES: vscode.DocumentSelector = { scheme: 'file' };
let settleExecutions: (() => Promise<void>) | undefined;


export function activate(context: vscode.ExtensionContext): void {
  reviewNavigation.register(context);
  let lastConfiguredProvider = getConfig().aiProvider;
  let providerUpdateFromWizard: AccountProvider | undefined;

  // ── Helpers ─────────────────────────────────────────────────────────────
  async function resolveRepoRoot(): Promise<string | undefined> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { return undefined; }
    try { return await getRepoRoot(ws); } catch { return undefined; }
  }

  async function chooseAccountModel(
    provider: AccountProvider,
    includeDefault = true,
  ): Promise<string | undefined> {
    type ModelChoice = vscode.QuickPickItem & { model?: string; custom?: boolean };
    const current = getConfig();
    const choices: ModelChoice[] = [];
    if (provider === 'codex') {
      choices.push({ label: '$(sparkle) gpt-6-astra', description: 'xhigh · standalone review',
        detail: 'Requires the supported local Codex executable. Uses captured source, base and related context.', model: 'gpt-6-astra' });
    } else if (includeDefault) {
      choices.push({
        label: '$(sparkle) CLI default model',
        description: 'Recommended',
        detail: 'Let the authenticated CLI select its current default model.',
        model: '',
      });
    }
    if (provider === 'claudecode') {
      choices.push(
        { label: '$(symbol-variable) sonnet', description: 'Claude Code alias', model: 'sonnet' },
        { label: '$(symbol-variable) opus', description: 'Claude Code alias', model: 'opus' },
      );
    } else if (provider === 'geminicli') {
      choices.push(
        { label: '$(symbol-variable) auto', description: 'Gemini CLI alias', model: 'auto' },
        { label: '$(symbol-variable) pro', description: 'Gemini CLI alias', model: 'pro' },
        { label: '$(symbol-variable) flash', description: 'Gemini CLI alias', model: 'flash' },
        { label: '$(symbol-variable) flash-lite', description: 'Gemini CLI alias', model: 'flash-lite' },
      );
    }
    if (current.aiProvider === provider && current.model.trim()
        && !choices.some(choice => choice.model === current.model.trim())) {
      choices.splice(includeDefault ? 1 : 0, 0, {
        label: `$(history) ${current.model.trim()}`,
        description: 'Current model',
        model: current.model.trim(),
      });
    }
    choices.push({
      label: '$(edit) Enter a model ID…',
      detail: 'Use any model name accepted by the selected local CLI and account.',
      custom: true,
    });

    const picked = await vscode.window.showQuickPick(choices, {
      title: `Commit Defender: Select ${accountProviderName(provider)} model`,
      placeHolder: includeDefault
        ? 'Choose the CLI default, an alias, or enter an exact model ID'
        : 'Choose an alias or enter an exact model ID',
      ignoreFocusOut: true,
    });
    if (!picked) { return undefined; }
    if (!picked.custom) { return picked.model ?? ''; }
    return vscode.window.showInputBox({
      title: `Commit Defender: ${accountProviderName(provider)} model ID`,
      prompt: 'Enter an exact model ID supported by the local CLI and authenticated account.',
      value: current.aiProvider === provider ? current.model : '',
      ignoreFocusOut: true,
      validateInput: value => value.trim() ? undefined : 'Enter a model ID, or go back and choose CLI default.',
    }).then(value => value?.trim());
  }

  async function applyAccountProvider(provider: AccountProvider, model: string): Promise<void> {
    const settings = vscode.workspace.getConfiguration('commitDefender');
    const target = vscode.ConfigurationTarget.Global;
    providerUpdateFromWizard = provider;
    // Clear an API-provider model before switching provider so no analysis can
    // observe the new CLI provider with the previous provider's model ID.
    await settings.update('model', model, target);
    if (provider === 'codex') await settings.update('reviewReasoningEffort', 'xhigh', target);
    await settings.update('aiProvider', provider, target);
    setTimeout(() => {
      if (providerUpdateFromWizard === provider) { providerUpdateFromWizard = undefined; }
    }, 1000);
    const modelLabel = model || 'CLI default';
    vscode.window.showInformationMessage(
      `Commit Defender: ${accountProviderName(provider)} is now the AI provider (${modelLabel}).`,
    );
  }

  async function promptModelAtProviderSetup(provider: AccountProvider): Promise<boolean> {
    if (provider === 'codex') {
      const model = await chooseAccountModel(provider, false);
      if (model === undefined) return false;
      await applyAccountProvider(provider, model);
      return true;
    }
    const name = accountProviderName(provider);
    const action = await vscode.window.showInformationMessage(
      `Commit Defender: Use the ${name} CLI default model in user settings? Fixed-source standalone review is not yet supported by this provider.`,
      'Use CLI Default',
      'Choose Model…',
    );
    if (action === 'Use CLI Default') {
      await applyAccountProvider(provider, '');
      return true;
    }
    if (action === 'Choose Model…') {
      const model = await chooseAccountModel(provider, false);
      if (model !== undefined) {
        await applyAccountProvider(provider, model);
        return true;
      }
    }
    return false;
  }

  async function promptProviderChangeAfterSignIn(provider: AccountProvider): Promise<void> {
    if (provider === 'codex') {
      await promptModelAtProviderSetup(provider);
      return;
    }
    const name = accountProviderName(provider);
    const action = await vscode.window.showInformationMessage(
      `Commit Defender: ${name} sign-in opened in the terminal. Use ${name} in user settings and change its model?`,
      'Use CLI Default',
      'Choose Model…',
      'Keep Current Provider',
    );
    if (action === 'Use CLI Default') {
      await applyAccountProvider(provider, '');
    } else if (action === 'Choose Model…') {
      const model = await chooseAccountModel(provider, false);
      if (model !== undefined) { await applyAccountProvider(provider, model); }
    }
  }

  async function selectAccountProviderAndModel(): Promise<void> {
    type ProviderChoice = vscode.QuickPickItem & { provider: AccountProvider };
    const choices: ProviderChoice[] = [
      { label: 'Codex', description: 'Standalone review · gpt-6-astra / xhigh', provider: 'codex' },
      { label: 'Claude Code', description: 'Account login and commit messages; standalone review unavailable', provider: 'claudecode' },
      { label: 'Gemini CLI', description: 'Account login and commit messages; standalone review unavailable', provider: 'geminicli' },
      { label: 'Antigravity', description: 'Account login and commit messages; standalone review unavailable', provider: 'antigravity' },
    ];
    const picked = await vscode.window.showQuickPick(choices, {
      title: 'Commit Defender: Select account provider',
      placeHolder: 'Choose the authenticated CLI backbone',
      ignoreFocusOut: true,
    });
    if (!picked) { return; }
    await promptModelAtProviderSetup(picked.provider);
  }

  async function signIn(provider: AccountProvider): Promise<boolean> {
    const config = getConfig();
    const isCodex = provider === 'codex';
    const isClaude = provider === 'claudecode';
    const isGeminiCli = provider === 'geminicli';
    const name = accountProviderName(provider);
    const executable = isCodex
      ? config.codexPath
      : isClaude
        ? config.claudeCodePath
        : isGeminiCli
          ? config.geminiCliPath
          : config.antigravityPath;
    const cwd = await resolveRepoRoot()
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? process.cwd();

    if (path.isAbsolute(executable) && !fs.existsSync(executable)) {
      vscode.window.showErrorMessage(
        `Commit Defender: ${name} CLI executable was not found at "${executable}". Update the corresponding path setting.`,
      );
      return false;
    }

    const shellArgs = isCodex ? ['login'] : isClaude ? ['auth', 'login', '--claudeai'] : [];
    const env: Record<string, string | null> = {};
    if (isClaude) {
      env.ANTHROPIC_API_KEY = null;
      env.ANTHROPIC_AUTH_TOKEN = null;
    } else if (provider === 'geminicli') {
      env.GEMINI_API_KEY = null;
      env.GOOGLE_API_KEY = null;
      env.GOOGLE_GENAI_USE_VERTEXAI = null;
      env.GOOGLE_GENAI_USE_GCA = 'true';
    }
    const terminal = vscode.window.createTerminal({
      name: `Commit Defender: ${name} Sign in`,
      shellPath: executable,
      shellArgs,
      cwd,
      env,
    });
    terminal.show(false);
    getOutputChannel().appendLine(`[Commit Defender] Started ${name} sign-in in an integrated terminal: ${executable}`);
    await promptProviderChangeAfterSignIn(provider);
    return true;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('commitDefender.signInCodex', () => signIn('codex')),
    vscode.commands.registerCommand('commitDefender.signInClaudeCode', () => signIn('claudecode')),
    vscode.commands.registerCommand('commitDefender.signInGeminiCli', () => signIn('geminicli')),
    vscode.commands.registerCommand('commitDefender.signInAntigravity', () => signIn('antigravity')),
    vscode.commands.registerCommand('commitDefender.selectAccountProviderAndModel', selectAccountProviderAndModel),
  );

  // ── Pre-commit hook commands ────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.installPreCommitHook',
    async () => {
      const repoRoot = await resolveRepoRoot();
      if (!repoRoot) {
        vscode.window.showWarningMessage('Commit Defender: No git repository found in workspace.');
        return;
      }
      await installHook(repoRoot, context.extensionPath, getConfig());
    },
  ));

  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.uninstallPreCommitHook',
    async () => {
      const repoRoot = await resolveRepoRoot();
      if (!repoRoot) {
        vscode.window.showWarningMessage('Commit Defender: No git repository found in workspace.');
        return;
      }
      await uninstallHook(repoRoot);
    },
  ));

  // ── React to setting changes ───────────────────────────────────────────
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e => {
    if (e.affectsConfiguration('commitDefender')) {
      const nextConfig = getConfig();
      const previousProvider = lastConfiguredProvider;
      lastConfiguredProvider = nextConfig.aiProvider;
      historyProvider.updateConfig(nextConfig);

      if (e.affectsConfiguration('commitDefender.aiProvider')
          && nextConfig.aiProvider !== previousProvider) {
        const account = accountProvider(nextConfig.aiProvider);
        if (account && providerUpdateFromWizard === account) {
          providerUpdateFromWizard = undefined;
        } else if (account) {
          await promptModelAtProviderSetup(account);
        }
      }

      // Mirror settings into the hook config file so the hook picks them up
      // on the next commit, even when VS Code isn't running.
      const repoRoot = await resolveRepoRoot();
      if (repoRoot && hookIsInstalled(repoRoot)) {
        try { writeHookConfig(repoRoot, getConfig()); }
        catch (err) {
          getOutputChannel().appendLine(`[Commit Defender] Could not update hook config: ${(err as Error).message}`);
        }
      }
    }
    if (e.affectsConfiguration('commitDefender.preCommitHook')) {
      const hook = getConfig().preCommitHook;
      if (hook === 'enable') {
        vscode.commands.executeCommand('commitDefender.installPreCommitHook');
      } else {
        vscode.commands.executeCommand('commitDefender.uninstallPreCommitHook');
      }
    }
    // Re-render the summary panel when the color palette changes.
    if (e.affectsConfiguration('commitDefender.colorPalette')) {
      if (_summaryView && _summaryPanel) {
        renderSummary(_summaryView.report, _summaryView.repoRoot);
      }
    }
  }));

  // ── On activation: install hook if already enabled ─────────────────────
  const cfg = getConfig();
  if (cfg.preCommitHook === 'enable') {
    resolveRepoRoot().then(repoRoot => {
      if (repoRoot) { installHook(repoRoot, context.extensionPath, getConfig()); }
    });
  }

  const diagnostics    = vscode.languages.createDiagnosticCollection('commit-defender');
  const commentCtrl    = vscode.comments.createCommentController('commit-defender', 'Commit Defender');
  const commentManager = new CommentManager();
  const statusBar      = new StatusBarManager();
  const execution = new ReviewExecutionOwner<RunResult>();
  const messageExecution = new ReviewExecutionOwner<CommitMessageResult>();
  settleExecutions = async () => {
    execution.invalidate(); messageExecution.invalidate();
    await Promise.all([execution.settled(), messageExecution.settled()]);
  };
  let reviewIntent = 0;
  let messageIntent = 0;
  const setPreflightIdle = (message?: string, intent = reviewIntent): void => { if (intent === reviewIntent && !execution.isRunning) statusBar.setIdle(message); };
  context.subscriptions.push({ dispose: () => { execution.invalidate(); messageExecution.invalidate(); } });
  const codeLensProvider = new SuggestionCodeLensProvider();
  const historyProvider  = new HistoryProvider(cfg);
  const panelProvider    = new PanelProvider();
  const localProfile = () => vscode.workspace.getConfiguration('commitDefender').inspect<string>('localProfile')?.globalValue ?? 'default';
  let historyLoad = 0;
  async function refreshLocalHistory(): Promise<void> {
    const generation = ++historyLoad;
    const profileId = localProfile();
    const repoRoot = await resolveRepoRoot();
    if (!repoRoot || !vscode.workspace.isTrusted) return;
    try {
      const scope = knowledgeScope({ profileId, repoRoot, scope: 'repository' });
      if (scope.kind !== 'repository') return;
      const reports = await readLocalHistory({ profileId, repoRoot, scope: 'repository' });
      if (generation === historyLoad && localProfile() === profileId) historyProvider.restore(reports, repoRoot, scope);
    } catch {
      getOutputChannel().appendLine('[Commit Defender] Encrypted local history could not be loaded. Check the OS credential store and refresh local history.');
    }
  }
  async function refreshVisibleContext(): Promise<void> {
    const view = _summaryView;
    if (!view?.report.gcr) return;
    const freshness = await checkLocalContextFreshness(view.report.gcr.report);
    if (_summaryView !== view) return;
    view.report.local_context_freshness = freshness;
    renderSummary(view.report, view.repoRoot);
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('commitDefender.refreshLocalHistory', refreshLocalHistory),
    vscode.commands.registerCommand('commitDefender.manageLocalKnowledge', async () => {
      const repoRoot = await resolveRepoRoot();
      const choices = [
        ...(repoRoot && vscode.workspace.isTrusted ? [{ label: 'This worktree', description: 'Only this repository and worktree', scope: 'repository' as const }] : []),
        { label: 'Current profile', description: 'Shared across repositories in this local profile', scope: 'profile' as const },
      ];
      const selected = await vscode.window.showQuickPick(choices, { title: 'Local Memory and Skills: choose scope' });
      if (!selected) return;
      try {
        const scope = knowledgeScope({ repoRoot, profileId: localProfile(), scope: selected.scope });
        await showLocalKnowledge(context, scope, refreshVisibleContext);
      } catch { void vscode.window.showErrorMessage('Local knowledge could not be opened. Check the profile and OS credential store.'); }
    }),
    vscode.window.onDidChangeWindowState(event => { if (event.focused) void refreshVisibleContext(); }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('commitDefender.localProfile')) {
        historyLoad++;
        void vscode.commands.executeCommand('commitDefender.clearFindings').then(() => refreshLocalHistory());
      }
    }),
  );
  void refreshLocalHistory();

  const historyView = vscode.window.createTreeView('commitDefender.history', {
    treeDataProvider: historyProvider,
    showCollapseAll: false,
  });
  const panelView = vscode.window.createTreeView('commitDefender.panelView', {
    treeDataProvider: panelProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    diagnostics,
    commentCtrl,
    statusBar.item,
    historyView,
    panelView,
    vscode.window.registerFileDecorationProvider(panelProvider.decorationProvider),
    vscode.languages.registerCodeLensProvider(ALL_FILES, codeLensProvider),
  );

  const invalidateChangedSource = (document: vscode.TextDocument): void => {
    if (document.uri.scheme !== 'file') return;
    const last = findingsStore.lastReport();
    if (!last) return;
    const file = path.relative(last.repoRoot, document.uri.fsPath).split(path.sep).join('/');
    if (!last.report.staged_files.includes(file)) return;
    if (liveSource(last.repoRoot, last.report, file, document.getText()) !== undefined) return;
    diagnostics.delete(document.uri);
    commentManager.clearFile(document.uri);
    findingsStore.invalidateFile(document.uri);
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => invalidateChangedSource(event.document)),
    vscode.workspace.onDidOpenTextDocument(invalidateChangedSource),
  );

  // ── Shared analysis pipeline ────────────────────────────────────────────
  // repoRoot must be the NON-resolved path (e.g. /Users/… not /private/Users/…)
  // so VS Code URIs built from it match open editor documents.
  async function analyze(
    relPaths: string[],
    repoRoot: string,
    scope: AnalysisScope = 'staged',
    scopeTarget?: string,
    sourceExclusions: SourceExclusion[] = [],
  ): Promise<void> {
    const cfg = getConfig();
    const localSettings = getStandaloneReviewSettings(relPaths.length);
    const backend = createReviewBackend(cfg, {
      workerFile: context.asAbsolutePath('out/standalone-review-worker.js'),
      settings: localSettings,
    });
    await execution.prepare(signal => backend.prepareReview({repoRoot, files:relPaths, scope, scopeTarget, sourceExclusions}, signal), {
      preparing: () => {
        statusBar.setPreparing();
        historyProvider.setRunning(true);
        panelProvider.setRunning(true);
      },
      started: () => {
        statusBar.setRunning();
        historyProvider.setRunning(true);
        panelProvider.setRunning(true);
      },
      progress: (current, total, file) => statusBar.setProgress(current, total, file),
      error: error => {
        const message = error instanceof Error ? error.message : 'Local review preparation failed.';
        statusBar.setError(message);
        getOutputChannel().appendLine(`[Commit Defender] ${message}`);
        void vscode.window.showErrorMessage(
          error instanceof Error ? error.message : 'Local review preparation failed.',
          'Choose Account and Model…', 'Open User Settings',
        ).then(action => {
          if (action === 'Choose Account and Model…') return selectAccountProviderAndModel();
          if (action === 'Open User Settings') return vscode.commands.executeCommand('workbench.action.openSettings', '@ext:pydemia.commit-defender');
        });
      },
      finished: () => {
        if (execution.isRunning) return;
        historyProvider.setRunning(false);
        panelProvider.setRunning(false);
      },
      result: async (result, isCurrent) => {
        retainCapturedSources(result.report, result.capturedSources);
        result.report.source_exclusions = [...new Map(
          [...sourceExclusions, ...(result.report.source_exclusions ?? [])].map(entry => [`${entry.path}\0${entry.reason}`, entry]),
        ).values()];
        logSourceExclusions(result.report.source_exclusions);
        if (result.stderr) getOutputChannel().appendLine(`[Commit Defender] ${result.stderr}`);

        const displayBlocks = liveBlocks(result.report, repoRoot, normalizeReport(result.report), file => {
          const uri = vscode.Uri.file(path.join(repoRoot, file)).toString();
          return vscode.workspace.textDocuments.find(document => document.uri.toString() === uri)?.getText();
        });
        findingsStore.update(result.report, repoRoot, displayBlocks);
        historyProvider.push(result.report, repoRoot, scope, scopeTarget);
        const blocks = findingsStore.lastReport()!.blocks;
        historyProvider.updateFindings(blocks);
        panelProvider.updateFindings(blocks, repoRoot, result.report);
        applyDiagnostics(displayBlocks, repoRoot, diagnostics);
        commentManager.apply(displayBlocks, repoRoot, commentCtrl, result.report);

        const status = reviewStatus(result.report.review);
        if (execution.isPreparing) statusBar.setPreparing();
        else statusBar.setReport(result.report);
        if (status === 'failed') {
          const msg = result.report.review.summary.replace(/^AI review unavailable:\s*/i, '');
          const provider = accountProvider(cfg.aiProvider);
          const signIn = provider ? signInLabel(provider) : undefined;
          const actions = signIn ? [signIn, 'Show Summary', 'Show Output'] : ['Show Summary', 'Show Output'];
          void vscode.window.showErrorMessage(`Commit Defender: Review failed — ${msg}`, ...actions).then(async action => {
            if (action === signIn && provider) await vscode.commands.executeCommand(signInCommand(provider));
            else if (action === 'Show Summary') showSummaryPanel(result.report, repoRoot, context);
            else if (action === 'Show Output') getOutputChannel().show();
          });
        }

        showSummaryPanel(result.report, repoRoot, context);
        await vscode.commands.executeCommand('commitDefender.panelView.focus');
        if (!isCurrent()) return;

        const srcFile = result.report.staged_files[0];
        const command = srcFile && reviewNavigation.sourceCommand(repoRoot, result.report, srcFile, 1);
        if (command) await reviewNavigation.open(command.arguments?.[0], isCurrent);
      },
    }, localSettings.durationMs);
  }

  // ── 1. Analyze Current File ────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.analyzeCurrentFile',
    async (uri?: vscode.Uri) => {
      const intent = ++reviewIntent;
      let filePath: string;
      if (uri?.scheme === 'file') {
        filePath = uri.fsPath;
      } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file') {
          vscode.window.showWarningMessage('Commit Defender: Open a file in the editor first.');
          return;
        }
        filePath = editor.document.uri.fsPath;
      }

      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) { return; }

      try {
        const rawRoot = await getRepoRoot(ws);
        if (intent !== reviewIntent) return;

        // Resolve symlinks for path.relative() only — pass rawRoot to analyze
        // so VS Code URIs match open editors on macOS (/Users vs /private/Users).
        let resolvedRoot = rawRoot;
        let resolvedFile = filePath;
        try {
          resolvedRoot = fs.realpathSync(rawRoot);
          resolvedFile = fs.realpathSync(filePath);
        } catch { /* fall back */ }

        const relPath = path.relative(resolvedRoot, resolvedFile);
        const channel = getOutputChannel();
        channel.appendLine(`\n[Commit Defender] Analyze File:`);
        channel.appendLine(`  file    : ${filePath}`);
        channel.appendLine(`  rawRoot : ${rawRoot}`);
        channel.appendLine(`  relPath : ${relPath || '(empty)'}`);

        if (!relPath || relPath.startsWith('..')) {
          vscode.window.showWarningMessage('Commit Defender: File is outside the repository.');
          setPreflightIdle(undefined, intent);
          return;
        }

        if (intent !== reviewIntent) return;
        await analyze([relPath], rawRoot, 'file');
      } catch (err) {
        handleError(err, statusBar, intent === reviewIntent && !execution.isRunning);
      }
    }
  ));

  // ── 2. Analyze Directory ───────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.analyzeDirectory',
    async (uri?: vscode.Uri) => {
      const intent = ++reviewIntent;
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) { return; }

      let rawRoot: string;
      try {
        rawRoot = await getRepoRoot(ws);
        if (intent !== reviewIntent) return;
      } catch (err) {
        handleError(err, statusBar, intent === reviewIntent && !execution.isRunning);
        return;
      }

      const dirPath = (uri?.scheme === 'file') ? uri.fsPath : await pickDirectory(rawRoot);
      if (!dirPath) { return; }

      try {
        const cfg = getConfig();
        const sourceExclusions: SourceExclusion[] = [];
        const relPaths = collectFiles(dirPath, rawRoot, cfg.excludePatterns, entry => sourceExclusions.push(entry));
        if (relPaths.length === 0) {
          logSourceExclusions(sourceExclusions, true);
          setPreflightIdle('No supported files found', intent);
          vscode.window.showInformationMessage('Commit Defender: No analyzable files found in that directory.');
          return;
        }

        const channel = getOutputChannel();
        channel.appendLine(`\n[Commit Defender] Analyze Directory: ${path.relative(rawRoot, dirPath) || '.'}`);
        channel.appendLine(`  ${relPaths.length} file(s) found`);

        if (intent !== reviewIntent) return;
        await analyze(relPaths, rawRoot, 'directory', dirPath, sourceExclusions);
      } catch (err) {
        handleError(err, statusBar, intent === reviewIntent && !execution.isRunning);
      }
    }
  ));

  // ── 3. Analyze Staged Files ────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.analyze',
    async () => {
      const intent = ++reviewIntent;
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        vscode.window.showWarningMessage('Commit Defender: No workspace folder open.');
        return;
      }

      try {
        const rawRoot = await getRepoRoot(ws);
        if (intent !== reviewIntent) return;
        const cfg = getConfig();

        const sourceExclusions: SourceExclusion[] = [];

        const staged = await getStagedFiles(rawRoot, cfg.excludePatterns, entry => sourceExclusions.push(entry));
        if (staged.length === 0) {
          logSourceExclusions(sourceExclusions, true);
          setPreflightIdle('No staged files', intent);
          vscode.window.showInformationMessage('Commit Defender: No staged files to analyze. Use "Analyze Directory" or "Analyze Repository" for a broader scan.');
          return;
        }

        if (cfg.stagedFilesWarnThreshold > 0 && staged.length > cfg.stagedFilesWarnThreshold) {
          const answer = await vscode.window.showWarningMessage(
            `Commit Defender: ${staged.length} files are staged. Analyzing this many files may take a while.`,
            { modal: true },
            'Proceed to Analyze',
            'Skip',
            'Abort',
          );
          if (answer === 'Skip') {
            setPreflightIdle('Analysis skipped', intent);
            vscode.window.showInformationMessage('Commit Defender: Analysis skipped.');
            return;
          }
          if (answer === 'Abort' || answer === undefined) {
            setPreflightIdle('Commit aborted', intent);
            vscode.window.showWarningMessage('Commit Defender: Commit aborted. Fix or unstage files before committing.');
            return;
          }
        }

        const channel = getOutputChannel();
        channel.appendLine(`\n[Commit Defender] Analyze Staged Files: ${staged.length} file(s)`);

        if (intent !== reviewIntent) return;
        await analyze(staged, rawRoot, 'staged', undefined, sourceExclusions);
      } catch (err) {
        handleError(err, statusBar, intent === reviewIntent && !execution.isRunning);
      }
    }
  ));

  // ── 4. Analyze Repository ──────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.analyzeRepository',
    async () => {
      const intent = ++reviewIntent;
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) { return; }

      try {
        const cfg = getConfig();
        const rawRoot = await getRepoRoot(ws);
        if (intent !== reviewIntent) return;
        const sourceExclusions: SourceExclusion[] = [];
        const allFiles = collectFiles(rawRoot, rawRoot, cfg.excludePatterns, entry => sourceExclusions.push(entry));
        if (allFiles.length === 0) {
          logSourceExclusions(sourceExclusions, true);
          setPreflightIdle('No files found', intent);
          vscode.window.showInformationMessage('Commit Defender: No analyzable files found in the repository.');
          return;
        }

        if (cfg.repoAnalysisWarnThreshold > 0 && allFiles.length > cfg.repoAnalysisWarnThreshold) {
          const answer = await vscode.window.showWarningMessage(
            `Commit Defender: Found ${allFiles.length} files. The captured selection may exceed the review budget. Any unfinished file coverage will be reported as incomplete. Continue?`,
            { modal: true },
            'Analyze',
          );
          if (answer !== 'Analyze') {
            setPreflightIdle(undefined, intent);
            return;
          }
        }

        const channel = getOutputChannel();
        channel.appendLine(`\n[Commit Defender] Analyze Repository: ${allFiles.length} file(s)`);

        if (intent !== reviewIntent) return;
        await analyze(allFiles, rawRoot, 'repository', undefined, sourceExclusions);
      } catch (err) {
        handleError(err, statusBar, intent === reviewIntent && !execution.isRunning);
      }
    }
  ));

  // ── Cancel running analysis ────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand('commitDefender.cancel', () => {
    reviewIntent++;
    execution.cancel();
  }));

  // ── Clear findings ─────────────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand('commitDefender.clearFindings', () => {
    reviewIntent++;
    execution.invalidate();
    _summaryPanel?.dispose();
    reviewNavigation.links.clear();
    historyProvider.setRunning(false);
    panelProvider.setRunning(false);
    diagnostics.clear();
    commentManager.clearAll();
    findingsStore.clear();
    historyProvider.clear();
    panelProvider.clear();
    setPreflightIdle();
  }));

  // ── Show line suggestion (CodeLens click) ──────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.showLineSuggestion',
    async (uri: unknown, line0: unknown) => {
      if (!(uri instanceof vscode.Uri) || uri.scheme !== 'file' || typeof line0 !== 'number'
          || !Number.isSafeInteger(line0) || line0 < 0) return;
      const last = findingsStore.lastReport();
      if (!last || !findingsStore.get(uri)?.byLine.has(line0)) return;
      const file = path.relative(last.repoRoot, uri.fsPath).split(path.sep).join('/');
      const command = reviewNavigation.sourceCommand(last.repoRoot, last.report, file, line0 + 1);
      if (command) await reviewNavigation.open(command.arguments?.[0]);
    }
  ));

  // ── Show summary panel (manual re-open) ────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.showSummary',
    () => {
      const last = findingsStore.lastReport();
      if (!last) {
        vscode.window.showInformationMessage('Commit Defender: No analysis has been run yet.');
        return;
      }
      showSummaryPanel(last.report, last.repoRoot, context);
    }
  ));

  // ── Show history entry ─────────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.showHistoryEntry',
    (entry: import('./historyProvider.js').HistoryEntry) => {
      showSummaryPanel(entry.report, entry.repoRoot, context);
    }
  ));

  // ── Re-analyze history entry ───────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.reanalyzeHistoryEntry',
    async (arg: unknown) => {
      const intent = ++reviewIntent;
      type HEntry = import('./historyProvider.js').HistoryEntry;
      const histEntry: HEntry | undefined =
        (arg as any)?.kind === 'entry' ? (arg as any).entry as HEntry :
        (arg as any)?.report           ? arg as HEntry               : undefined;

      if (!histEntry) {
        vscode.window.showWarningMessage('Commit Defender: Could not read history entry.');
        return;
      }

      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) { return; }

      try {
        const cfg = getConfig();
        const rawRoot = await getRepoRoot(ws);
        if (intent !== reviewIntent) return;
        const channel = getOutputChannel();

        switch (histEntry.scope) {
          case 'staged': {
            const sourceExclusions: SourceExclusion[] = [];
            const staged = await getStagedFiles(rawRoot, cfg.excludePatterns, entry => sourceExclusions.push(entry));
            if (staged.length === 0) {
              logSourceExclusions(sourceExclusions, true);
              setPreflightIdle('No staged files', intent);
              vscode.window.showInformationMessage('Commit Defender: No staged files to analyze.');
              return;
            }
            channel.appendLine(`\n[Commit Defender] Re-analyze (staged): ${staged.length} file(s)`);
            if (intent !== reviewIntent) return;
            await analyze(staged, rawRoot, 'staged', undefined, sourceExclusions);
            break;
          }
          case 'selection':
          case 'file': {
            const files = histEntry.report.staged_files;
            if (!files.length) {
              vscode.window.showWarningMessage('Commit Defender: No file recorded in this history entry.');
              setPreflightIdle(undefined, intent);
              return;
            }
            channel.appendLine(`\n[Commit Defender] Re-analyze (file): ${files[0]}`);
            if (intent !== reviewIntent) return;
            await analyze(files, histEntry.repoRoot, histEntry.scope);
            break;
          }
          case 'directory': {
            const dirPath = histEntry.scopeTarget;
            if (!dirPath) {
              vscode.window.showWarningMessage('Commit Defender: No directory recorded in this history entry.');
              setPreflightIdle(undefined, intent);
              return;
            }
            const sourceExclusions: SourceExclusion[] = [];
            const relPaths = collectFiles(dirPath, rawRoot, cfg.excludePatterns, entry => sourceExclusions.push(entry));
            if (relPaths.length === 0) {
              logSourceExclusions(sourceExclusions, true);
              setPreflightIdle('No supported files found', intent);
              vscode.window.showInformationMessage('Commit Defender: No analyzable files found in that directory.');
              return;
            }
            channel.appendLine(`\n[Commit Defender] Re-analyze (directory): ${path.relative(rawRoot, dirPath) || '.'}, ${relPaths.length} file(s)`);
            if (intent !== reviewIntent) return;
            await analyze(relPaths, rawRoot, 'directory', dirPath, sourceExclusions);
            break;
          }
          case 'repository': {
            const sourceExclusions: SourceExclusion[] = [];
            const allFiles = collectFiles(rawRoot, rawRoot, cfg.excludePatterns, entry => sourceExclusions.push(entry));
            if (allFiles.length === 0) {
              logSourceExclusions(sourceExclusions, true);
              setPreflightIdle('No files found', intent);
              vscode.window.showInformationMessage('Commit Defender: No analyzable files found in the repository.');
              return;
            }
            channel.appendLine(`\n[Commit Defender] Re-analyze (repository): ${allFiles.length} file(s)`);
            if (intent !== reviewIntent) return;
            await analyze(allFiles, rawRoot, 'repository', undefined, sourceExclusions);
            break;
          }
        }
      } catch (err) {
        handleError(err, statusBar, intent === reviewIntent && !execution.isRunning);
      }
    }
  ));

  // ── Generate commit message ────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.generateCommitMessage',
    async () => {
      const intent = ++messageIntent;
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        vscode.window.showWarningMessage('Commit Defender: No workspace folder open.');
        return;
      }
      let repoRoot: string;
      try { repoRoot = await getRepoRoot(ws); }
      catch { vscode.window.showWarningMessage('Commit Defender: No git repository found.'); return; }

      if (intent !== messageIntent) return;
      const cfg = getConfig();
      const prepared = createLegacyReviewBackend(cfg).prepareCommitMessage(repoRoot);
      await messageExecution.start({
        ...prepared,
        run: async signal => vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Commit Defender: Generating commit message…', cancellable: false },
          () => prepared.run(signal),
        ),
      }, {
        error: error => handleError(error, statusBar, !execution.isRunning),
        result: async (result, isCurrent) => {
          if (result.is_error || !result.commit_message) {
            const provider = accountProvider(cfg.aiProvider);
            const signIn = provider ? signInLabel(provider) : undefined;
            const action = await vscode.window.showErrorMessage(
              `Commit Defender: ${result.error || 'Failed to generate commit message'}`,
              ...(signIn ? [signIn] : []),
            );
            if (action === signIn && provider) {
              await vscode.commands.executeCommand(signInCommand(provider));
            }
            return;
          }

          const gitExt = vscode.extensions.getExtension('vscode.git');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const gitApi = (gitExt?.exports as any)?.getAPI?.(1);
          const repo   = gitApi?.getRepository?.(vscode.Uri.file(repoRoot))
                      ?? gitApi?.repositories?.[0];

          if (repo?.inputBox) {
            repo.inputBox.value = result.commit_message;
            vscode.window.showInformationMessage(
              'Commit Defender: Commit message inserted into the Source Control input box.'
            );
          } else {
            await vscode.env.clipboard.writeText(result.commit_message);
            if (!isCurrent()) return;
            vscode.window.showInformationMessage(
              'Commit Defender: Commit message copied to clipboard.',
              'Preview'
            ).then(action => {
              if (action === 'Preview') {
                vscode.window.showInputBox({
                  value: result.commit_message,
                  prompt: 'Generated commit message (read-only preview)',
                  ignoreFocusOut: true,
                });
              }
            });
          }
        },
      }, cfg.fileTimeoutSeconds * 1000);
    }
  ));

  // ── Auto-trigger on git stage ──────────────────────────────────────────
  setupIndexWatcher(context);
}

export async function deactivate(): Promise<void> {
  await settleExecutions?.();
  settleExecutions = undefined;
  findingsStore.clear();
  disposeOutputChannel();
}

function accountProvider(provider: ExtensionConfig['aiProvider']): AccountProvider | undefined {
  return provider === 'codex' || provider === 'claudecode' || provider === 'geminicli' || provider === 'antigravity'
    ? provider
    : undefined;
}

function accountProviderName(provider: AccountProvider): string {
  return provider === 'codex'
    ? 'Codex'
    : provider === 'claudecode'
      ? 'Claude Code'
      : provider === 'geminicli'
        ? 'Gemini CLI'
        : 'Antigravity';
}

function signInLabel(provider: AccountProvider): string {
  return provider === 'codex'
    ? 'Sign in with Codex'
    : provider === 'claudecode'
      ? 'Sign in with Claude Code'
      : provider === 'geminicli'
        ? 'Sign in with Gemini'
        : 'Sign in with Antigravity';
}

function signInCommand(provider: AccountProvider): string {
  return provider === 'codex'
    ? 'commitDefender.signInCodex'
    : provider === 'claudecode'
      ? 'commitDefender.signInClaudeCode'
      : provider === 'geminicli'
        ? 'commitDefender.signInGeminiCli'
        : 'commitDefender.signInAntigravity';
}

// ── Directory quick-pick browser ──────────────────────────────────────────────

async function pickDirectory(root: string): Promise<string | undefined> {
  let current = root;

  while (true) {
    const rel = path.relative(root, current) || '.';
    const label = rel === '.' ? '$(root-folder) workspace root' : `$(folder) ${rel}`;

    const items: vscode.QuickPickItem[] = [];
    items.push({
      label: '$(check) Analyze this directory',
      description: rel,
      alwaysShow: true,
    });
    if (current !== root) {
      items.push({ label: '$(arrow-left) ..', description: 'Go up one level', alwaysShow: true });
    }

    let subdirs: string[] = [];
    try {
      subdirs = fs.readdirSync(current, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.') &&
                     !['node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build', 'out'].includes(e.name))
        .map(e => e.name)
        .sort();
    } catch { /* unreadable */ }

    for (const name of subdirs) {
      items.push({ label: `$(folder) ${name}`, description: path.join(rel, name) });
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: `Commit Defender — Select directory  [${label}]`,
      placeHolder: 'Navigate or choose "Analyze this directory"',
    });

    if (!picked) { return undefined; }
    if (picked.label.startsWith('$(check)')) { return current; }
    if (picked.label.startsWith('$(arrow-left)')) { current = path.dirname(current); }
    else { current = path.join(current, picked.label.replace('$(folder) ', '')); }
  }
}

// ── Error handling ────────────────────────────────────────────────────────────

function handleError(err: unknown, statusBar: StatusBarManager, updateStatus = true): void {
  const message = err instanceof Error ? err.message : String(err);
  if (updateStatus) statusBar.setError(message);
  const firstLine = message.split('\n')[0];
  vscode.window.showErrorMessage(`Commit Defender: ${firstLine}`, 'Show Output').then(action => {
    if (action === 'Show Output') { getOutputChannel().show(); }
  });
  const channel = getOutputChannel();
  channel.appendLine(`\n[Error] ${message}`);
  channel.show(true);
}

// ── Summary webview panel ─────────────────────────────────────────────────────

let _summaryPanel: vscode.WebviewPanel | undefined;
let _summaryView: SummaryView | undefined;

function renderSummary(report: AnalysisReport, repoRoot: string): void {
  _summaryView = new SummaryView(report, repoRoot, reviewNavigation.links, resolvePalette(getConfig().colorPalette));
  if (_summaryPanel) _summaryPanel.webview.html = _summaryView.html;
}

function showSummaryPanel(
  report: AnalysisReport,
  repoRoot: string,
  context: vscode.ExtensionContext,
): void {
  if (_summaryPanel) {
    _summaryPanel.reveal(vscode.ViewColumn.Beside, true);
  } else {
    _summaryPanel = vscode.window.createWebviewPanel(
      'commitDefenderSummary',
      'Commit Defender — Summary',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    _summaryPanel.onDidDispose(() => { _summaryPanel = undefined; _summaryView = undefined; }, null, context.subscriptions);

    _summaryPanel.webview.onDidReceiveMessage(
      async (value: unknown) => {
        const view = _summaryView;
        const message = view?.message(value);
        if (!view || !message) return;
        if (message.command === 'open') {
          await reviewNavigation.open(message.id);
        } else {
          const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(view.report, null, 2), language: 'json' });
          await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
        }
      },
      undefined,
      context.subscriptions,
    );
  }

  _summaryPanel.title = 'Commit Defender — Summary';
  renderSummary(report, repoRoot);
  const view = _summaryView;
  if (report.gcr) void checkLocalContextFreshness(report.gcr.report).then(freshness => {
    if (_summaryView !== view) return;
    report.local_context_freshness = freshness;
    renderSummary(report, repoRoot);
  });
}

function logSourceExclusions(excluded: SourceExclusion[], show = false): void {
  if (!excluded.length) return;
  const channel = getOutputChannel();
  for (const entry of excluded) channel.appendLine(`Source excluded: ${JSON.stringify(entry.path)} (${entry.reason})`);
  if (show) channel.show(true);
}

function setupIndexWatcher(context: vscode.ExtensionContext): void {
  const cfg = getConfig();
  if (!cfg.runOnStage) { return; }
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!ws) { return; }

  const indexPattern = new vscode.RelativePattern(
    vscode.Uri.file(path.join(ws.fsPath, '.git')),
    'index'
  );
  const watcher = vscode.workspace.createFileSystemWatcher(indexPattern, false, false, true);
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const trigger = (): void => {
    clearTimeout(debounce);
    debounce = setTimeout(() => vscode.commands.executeCommand('commitDefender.analyze'), 2000);
  };
  watcher.onDidChange(trigger);
  watcher.onDidCreate(trigger);
  context.subscriptions.push(watcher);
}
