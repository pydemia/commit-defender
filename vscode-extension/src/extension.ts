import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Reviewer } from './ai/reviewer.js';
import { AccountProvider } from './ai/providers.js';
import { SuggestionCodeLensProvider } from './codeLens.js';
import { CommentManager } from './comments.js';
import { ExtensionConfig, getConfig } from './config.js';
import { applyDiagnostics } from './diagnostics.js';
import { findingsStore } from './findingsStore.js';
import { collectFiles, getRepoRoot, getStagedFiles } from './gitHelper.js';
import { HistoryProvider, AnalysisScope } from './historyProvider.js';
import { hookIsInstalled, installHook, uninstallHook, writeHookConfig } from './hook/install.js';
import { PanelProvider } from './panelProvider.js';
import { getOutputChannel, disposeOutputChannel } from './outputChannel.js';
import { StatusBarManager } from './statusBar.js';
import { AnalysisReport, CommentBlock, CommentPriority, PRIORITY_META, RunResult } from './types.js';
import { normalizeReport, worstPriority, metaForBlock, formatCategory, PRIORITY_RANK } from './commentFormatter.js';
import { Palette, resolvePalette, gradeColor as paletteGradeColor } from './palette.js';

const ALL_FILES: vscode.DocumentSelector = { scheme: 'file' };


export function activate(context: vscode.ExtensionContext): void {
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
    if (includeDefault) {
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
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    providerUpdateFromWizard = provider;
    // Clear an API-provider model before switching provider so no analysis can
    // observe the new CLI provider with the previous provider's model ID.
    await settings.update('model', model, target);
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
    const name = accountProviderName(provider);
    const action = await vscode.window.showInformationMessage(
      `Commit Defender: Use the ${name} CLI default model for this workspace?`,
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
    const name = accountProviderName(provider);
    const action = await vscode.window.showInformationMessage(
      `Commit Defender: ${name} sign-in opened in the terminal. Use ${name} for this workspace and change its model?`,
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
      { label: 'Codex', description: 'ChatGPT/Codex account', provider: 'codex' },
      { label: 'Claude Code', description: 'Claude subscription account', provider: 'claudecode' },
      { label: 'Gemini CLI', description: 'Google account authentication', provider: 'geminicli' },
      { label: 'Antigravity', description: 'Antigravity account via agy', provider: 'antigravity' },
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
      const last = findingsStore.lastReport();
      if (last && _summaryPanel) {
        const palette = resolvePalette(getConfig().colorPalette);
        _summaryPanel.webview.html = buildSummaryHtml(last.report, last.repoRoot, palette);
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
  let currentAbort: AbortController | null = null;
  const codeLensProvider = new SuggestionCodeLensProvider();
  const historyProvider  = new HistoryProvider(cfg);
  const panelProvider    = new PanelProvider();
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

  // ── Shared analysis pipeline ────────────────────────────────────────────
  // repoRoot must be the NON-resolved path (e.g. /Users/… not /private/Users/…)
  // so VS Code URIs built from it match open editor documents.
  async function analyze(
    relPaths: string[],
    repoRoot: string,
    scope: AnalysisScope = 'staged',
    scopeTarget?: string,
  ): Promise<void> {
    const cfg = getConfig();
    const timeoutSeconds = relPaths.length === 1
      ? cfg.fileTimeoutSeconds
      : cfg.directoryTimeoutSeconds;

    const reviewer = new Reviewer(cfg);
    const abort = new AbortController();
    currentAbort = abort;
    const timeoutHandle = timeoutSeconds > 0
      ? setTimeout(() => abort.abort('timeout'), timeoutSeconds * 1000)
      : null;

    historyProvider.setRunning(true);
    panelProvider.setRunning(true);

    let result: RunResult;
    try {
      if (scope === 'staged') {
        result = await reviewer.reviewDiff(repoRoot, relPaths, abort.signal);
      } else {
        result = await reviewer.reviewFilesSeparately(
          repoRoot, relPaths, abort.signal,
          (current, total, file) => statusBar.setProgress(current, total, file),
        );
      }
    } finally {
      if (timeoutHandle) { clearTimeout(timeoutHandle); }
      currentAbort = null;
      historyProvider.setRunning(false);
      panelProvider.setRunning(false);
    }

    if (result.cancelled) {
      const reason = abort.signal.reason === 'timeout' ? 'timed out' : 'cancelled';
      statusBar.setIdle(`Analysis ${reason}`);
      vscode.window.showInformationMessage(`Commit Defender: Analysis ${reason}.`);
      return;
    }

    if (result.report.staged_files.length === 0) {
      statusBar.setIdle('No files analyzed');
      const summary = result.report.review?.summary ?? 'No files matched for analysis.';
      const channel = getOutputChannel();
      channel.show(true);
      vscode.window.showInformationMessage(`Commit Defender: ${summary}`);
      return;
    }

    findingsStore.update(result.report, repoRoot);
    historyProvider.push(result.report, repoRoot, scope, scopeTarget);
    const blocks = findingsStore.lastReport()!.blocks;
    historyProvider.updateFindings(blocks);
    panelProvider.updateFindings(blocks, repoRoot);
    applyDiagnostics(blocks, repoRoot, diagnostics);
    commentManager.apply(blocks, repoRoot, commentCtrl);

    const passed = result.report.exit_code === 0;
    const isAiError = result.report.review.is_error
      || /AI review unavailable/i.test(result.report.review.summary);
    if (isAiError) {
      const msg = result.report.review.summary.replace(/^AI review unavailable:\s*/i, '');
      statusBar.setError(msg);
      const provider = accountProvider(cfg.aiProvider);
      const signIn = provider ? signInLabel(provider) : undefined;
      const actions = signIn ? [signIn, 'Show Summary', 'Show Output'] : ['Show Summary', 'Show Output'];
      const action = await vscode.window.showErrorMessage(
        `Commit Defender: AI review failed — ${msg}`,
        ...actions,
      );
      if (action === signIn && provider) {
        await vscode.commands.executeCommand(signInCommand(provider));
      } else if (action === 'Show Summary') {
        showSummaryPanel(result.report, repoRoot, context);
      } else if (action === 'Show Output') {
        getOutputChannel().show();
      }
    } else {
      statusBar.setResult(passed, result.report.review.grade);
    }

    showSummaryPanel(result.report, repoRoot, context);
    await vscode.commands.executeCommand('commitDefender.panelView.focus');

    // Bring the source file back to the front so inline comment threads render.
    const srcFile = result.report.staged_files[0] ?? relPaths[0];
    if (srcFile) {
      const absPath = path.join(repoRoot, srcFile);
      await vscode.window.showTextDocument(vscode.Uri.file(absPath), {
        preserveFocus: false,
        preview: false,
        viewColumn: vscode.ViewColumn.One,
      });
    }
  }

  // ── 1. Analyze Current File ────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.analyzeCurrentFile',
    async (uri?: vscode.Uri) => {
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

      statusBar.setRunning();
      try {
        const rawRoot = await getRepoRoot(ws);

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
          statusBar.setIdle();
          return;
        }

        await analyze([relPath], rawRoot, 'file');
      } catch (err) {
        handleError(err, statusBar);
      }
    }
  ));

  // ── 2. Analyze Directory ───────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.analyzeDirectory',
    async (uri?: vscode.Uri) => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) { return; }

      let rawRoot: string;
      try {
        rawRoot = await getRepoRoot(ws);
      } catch (err) {
        handleError(err, statusBar);
        return;
      }

      const dirPath = (uri?.scheme === 'file') ? uri.fsPath : await pickDirectory(rawRoot);
      if (!dirPath) { return; }

      statusBar.setRunning();
      try {
        const cfg = getConfig();
        const relPaths = collectFiles(dirPath, rawRoot, cfg.excludePatterns);
        if (relPaths.length === 0) {
          statusBar.setIdle('No supported files found');
          vscode.window.showInformationMessage('Commit Defender: No analyzable files found in that directory.');
          return;
        }

        const channel = getOutputChannel();
        channel.appendLine(`\n[Commit Defender] Analyze Directory: ${path.relative(rawRoot, dirPath) || '.'}`);
        channel.appendLine(`  ${relPaths.length} file(s) found`);

        await analyze(relPaths, rawRoot, 'directory', dirPath);
      } catch (err) {
        handleError(err, statusBar);
      }
    }
  ));

  // ── 3. Analyze Staged Files ────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.analyze',
    async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        vscode.window.showWarningMessage('Commit Defender: No workspace folder open.');
        return;
      }

      statusBar.setRunning();
      try {
        const rawRoot = await getRepoRoot(ws);
        const cfg = getConfig();

        const staged = await getStagedFiles(rawRoot, cfg.excludePatterns);
        if (staged.length === 0) {
          statusBar.setIdle('No staged files');
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
            statusBar.setIdle('Analysis skipped');
            vscode.window.showInformationMessage('Commit Defender: Analysis skipped.');
            return;
          }
          if (answer === 'Abort' || answer === undefined) {
            statusBar.setIdle('Commit aborted');
            vscode.window.showWarningMessage('Commit Defender: Commit aborted. Fix or unstage files before committing.');
            return;
          }
        }

        const channel = getOutputChannel();
        channel.appendLine(`\n[Commit Defender] Analyze Staged Files: ${staged.length} file(s)`);

        await analyze(staged, rawRoot, 'staged');
      } catch (err) {
        handleError(err, statusBar);
      }
    }
  ));

  // ── 4. Analyze Repository ──────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.analyzeRepository',
    async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) { return; }

      statusBar.setRunning();
      try {
        const cfg = getConfig();
        const rawRoot = await getRepoRoot(ws);
        const allFiles = collectFiles(rawRoot, rawRoot, cfg.excludePatterns);
        if (allFiles.length === 0) {
          statusBar.setIdle('No files found');
          vscode.window.showInformationMessage('Commit Defender: No analyzable files found in the repository.');
          return;
        }

        if (cfg.repoAnalysisWarnThreshold > 0 && allFiles.length > cfg.repoAnalysisWarnThreshold) {
          const answer = await vscode.window.showWarningMessage(
            `Commit Defender: Found ${allFiles.length} files. Analyzing the full repository may take a while and only the first ~80K characters of content will be reviewed. Continue?`,
            { modal: true },
            'Analyze',
          );
          if (answer !== 'Analyze') {
            statusBar.setIdle();
            return;
          }
        }

        const channel = getOutputChannel();
        channel.appendLine(`\n[Commit Defender] Analyze Repository: ${allFiles.length} file(s)`);

        await analyze(allFiles, rawRoot, 'repository');
      } catch (err) {
        handleError(err, statusBar);
      }
    }
  ));

  // ── Cancel running analysis ────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand('commitDefender.cancel', () => {
    if (currentAbort) {
      currentAbort.abort('user');
      currentAbort = null;
      statusBar.setIdle('Analysis cancelled');
    }
  }));

  // ── Clear findings ─────────────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand('commitDefender.clearFindings', () => {
    diagnostics.clear();
    commentManager.clearAll();
    findingsStore.clear();
    historyProvider.clear();
    panelProvider.clear();
    statusBar.setIdle();
  }));

  // ── Show line suggestion (CodeLens click) ──────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.showLineSuggestion',
    async (uri: vscode.Uri, line0: number) => {
      await vscode.window.showTextDocument(uri, {
        selection:     new vscode.Range(line0, 0, line0, 0),
        preserveFocus: false,
      });
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

      statusBar.setRunning();
      try {
        const cfg = getConfig();
        const rawRoot = await getRepoRoot(ws);
        const channel = getOutputChannel();

        switch (histEntry.scope) {
          case 'staged': {
            const staged = await getStagedFiles(rawRoot, cfg.excludePatterns);
            if (staged.length === 0) {
              statusBar.setIdle('No staged files');
              vscode.window.showInformationMessage('Commit Defender: No staged files to analyze.');
              return;
            }
            channel.appendLine(`\n[Commit Defender] Re-analyze (staged): ${staged.length} file(s)`);
            await analyze(staged, rawRoot, 'staged');
            break;
          }
          case 'file': {
            const files = histEntry.report.staged_files;
            if (!files.length) {
              vscode.window.showWarningMessage('Commit Defender: No file recorded in this history entry.');
              statusBar.setIdle();
              return;
            }
            channel.appendLine(`\n[Commit Defender] Re-analyze (file): ${files[0]}`);
            await analyze(files, histEntry.repoRoot, 'file');
            break;
          }
          case 'directory': {
            const dirPath = histEntry.scopeTarget;
            if (!dirPath) {
              vscode.window.showWarningMessage('Commit Defender: No directory recorded in this history entry.');
              statusBar.setIdle();
              return;
            }
            const relPaths = collectFiles(dirPath, rawRoot, cfg.excludePatterns);
            if (relPaths.length === 0) {
              statusBar.setIdle('No supported files found');
              vscode.window.showInformationMessage('Commit Defender: No analyzable files found in that directory.');
              return;
            }
            channel.appendLine(`\n[Commit Defender] Re-analyze (directory): ${path.relative(rawRoot, dirPath) || '.'}, ${relPaths.length} file(s)`);
            await analyze(relPaths, rawRoot, 'directory', dirPath);
            break;
          }
          case 'repository': {
            const allFiles = collectFiles(rawRoot, rawRoot, cfg.excludePatterns);
            if (allFiles.length === 0) {
              statusBar.setIdle('No files found');
              vscode.window.showInformationMessage('Commit Defender: No analyzable files found in the repository.');
              return;
            }
            channel.appendLine(`\n[Commit Defender] Re-analyze (repository): ${allFiles.length} file(s)`);
            await analyze(allFiles, rawRoot, 'repository');
            break;
          }
        }
      } catch (err) {
        handleError(err, statusBar);
      }
    }
  ));

  // ── Generate commit message ────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.generateCommitMessage',
    async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        vscode.window.showWarningMessage('Commit Defender: No workspace folder open.');
        return;
      }
      let repoRoot: string;
      try { repoRoot = await getRepoRoot(ws); }
      catch { vscode.window.showWarningMessage('Commit Defender: No git repository found.'); return; }

      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Commit Defender: Generating commit message…', cancellable: false },
        () => new Reviewer(getConfig()).generateCommitMessage(repoRoot),
      );

      if (result.is_error || !result.commit_message) {
        const provider = accountProvider(getConfig().aiProvider);
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
    }
  ));

  // ── Auto-trigger on git stage ──────────────────────────────────────────
  setupIndexWatcher(context);
}

export function deactivate(): void {
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

function handleError(err: unknown, statusBar: StatusBarManager): void {
  const message = err instanceof Error ? err.message : String(err);
  statusBar.setError(message);
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
      { enableScripts: true, retainContextWhenHidden: true },
    );
    _summaryPanel.onDidDispose(() => { _summaryPanel = undefined; }, null, context.subscriptions);

    _summaryPanel.webview.onDidReceiveMessage(
      async (msg: { command: string; path: string; line: number }) => {
        if (msg.command === 'open') {
          const uri = vscode.Uri.file(msg.path);
          const line = Math.max(0, (msg.line ?? 1) - 1);
          vscode.window.showTextDocument(uri, {
            selection: new vscode.Range(line, 0, line, 0),
            preserveFocus: false,
          });
        } else if (msg.command === 'showJson') {
          const json = JSON.stringify(report, null, 2);
          const doc = await vscode.workspace.openTextDocument({ content: json, language: 'json' });
          vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
        }
      },
      undefined,
      context.subscriptions,
    );
  }

  _summaryPanel.title = 'Commit Defender — Summary';
  const palette = resolvePalette(getConfig().colorPalette);
  _summaryPanel.webview.html = buildSummaryHtml(report, repoRoot, palette);
}

function _renderOverallSummary(
  review: AnalysisReport['review'],
  blocks: CommentBlock[],
  repoRoot: string,
  palette: Palette,
): string {
  const perFile = review.per_file_summaries ?? [];

  if (perFile.length === 0) {
    return `<div class="per-file-summary">${mdToHtml(review.summary)}</div>`;
  }

  const worstByFile = new Map<string, CommentPriority>();
  for (const b of blocks) {
    const cur = worstByFile.get(b.file);
    if (!cur || PRIORITY_RANK[b.priority] > PRIORITY_RANK[cur]) {
      worstByFile.set(b.file, b.priority);
    }
  }

  let html = '';
  for (const pfs of perFile) {
    const priority = worstByFile.get(pfs.file) ?? pfs.priority;
    const pMeta    = PRIORITY_META[priority];
    const pColor   = palette.priority[priority];
    const badge    = pMeta
      ? `<span class="priority-badge" style="color:${pColor}">${pMeta.emoji} ${priority} ${pMeta.label}</span>`
      : '';
    const absFile = path.join(repoRoot, pfs.file);
    html += `<div class="per-file-summary">
      <div class="per-file-header">
        <a class="file-link" data-path="${esc(absFile)}" data-line="1" href="#"><code>${esc(pfs.file)}</code></a>
        ${badge}
      </div>
      <div class="per-file-body">${mdToHtml(pfs.summary)}</div>
    </div>`;
  }
  return html;
}

function _renderFileBlocks(blocks: CommentBlock[], repoRoot: string, palette: Palette): string {
  const byFile = new Map<string, CommentBlock[]>();
  for (const b of blocks) {
    const list = byFile.get(b.file) ?? [];
    list.push(b);
    byFile.set(b.file, list);
  }
  let html = '';
  for (const [relFile, fileBlocks] of byFile) {
    const absFile = path.join(repoRoot, relFile);
    html += `<div class="file-block">
      <div class="file-name">
        <a class="file-link" data-path="${esc(absFile)}" data-line="1" href="#">${esc(relFile)}</a>
      </div>`;
    for (const b of fileBlocks) {
      const meta     = metaForBlock(b);
      const cat      = formatCategory(b.category);
      const catSlug  = (b.category || '').toLowerCase();
      const pColor   = palette.priority[b.priority];
      const pBadge   = `<span class="priority-badge" style="color:${pColor}">${meta.emoji} ${b.priority} ${meta.label}</span>`;
      const catBadge = b.priority !== 'P0' && b.category
        ? `<span class="cat cat-${esc(catSlug)}">${esc(cat)}</span>`
        : '';
      const lineRef  = b.line > 0
        ? `<a class="line-link" data-path="${esc(absFile)}" data-line="${b.line}" href="#">line ${b.line}</a>`
        : '<span class="line-label">file-level</span>';
      const bodyHtml = mdToHtml(b.comment);
      html += `<div class="suggestion priority-${esc(b.priority)}">
        <div class="suggestion-header">${pBadge} ${catBadge} &nbsp;${lineRef}</div>
        <div class="suggestion-body">${bodyHtml}</div>
      </div>`;
    }
    html += '</div>';
  }
  return html;
}

function buildSummaryHtml(report: AnalysisReport, repoRoot: string, palette?: Palette): string {
  const pal = palette ?? resolvePalette('theme-adaptive');
  const blocks = normalizeReport(report);

  const passed  = report.exit_code === 0;
  const grade   = report.review.grade;
  const isError = report.review.is_error || /AI review unavailable/i.test(report.review.summary);

  const wp     = worstPriority(blocks);
  const wpMeta = wp ? PRIORITY_META[wp] : undefined;

  const headerBadge = isError
    ? '<span class="badge" style="background:#888">AI ERROR ⚠</span>'
    : passed ? '<span class="badge pass">PASS ✓</span>'
             : '<span class="badge blocked">BLOCKED ✗</span>';
  const gradeBadge = grade
    ? `<span class="badge" style="background:${paletteGradeColor(pal, grade)}">${grade.toUpperCase()}</span>`
    : '';
  const worstBadge = wpMeta && wp
    ? `<span class="priority-badge" style="color:${pal.priority[wp]}">${wpMeta.emoji} ${wp} ${wpMeta.label}</span>`
    : '';

  const metaParts: string[] = [
    `${report.staged_files.length} file(s) analyzed`,
    blocks.length > 0 ? `${blocks.length} comment(s)` : '',
    isError
      ? '<span class="mode-tag" style="background:#c72e2e">ai error</span>'
      : '<span class="mode-tag">ai-powered</span>',
    `${report.duration_ms} ms`,
  ].filter(Boolean);

  let body = `
    <div class="header">
      <div class="header-row">
        <h1>🛡 Commit Defender &nbsp;${headerBadge} ${gradeBadge} &nbsp;${worstBadge}</h1>
        <button class="json-btn" id="btnShowJson" title="Open raw JSON report in editor">{ } Raw JSON</button>
      </div>
      <div class="meta">${metaParts.join(' &nbsp;·&nbsp; ')}</div>
    </div>`;

  if (report.review.summary) {
    if (isError) {
      const txt = report.review.summary.replace(/^AI review unavailable:\s*/i, '');
      body += `<section><h2>⚠ AI Review Error</h2>
        <div class="summary-error">${mdToHtml(txt)}</div></section>`;
    } else {
      body += `<section><h2>📋 Overall Summary</h2>
        ${_renderOverallSummary(report.review, blocks, repoRoot, pal)}</section>`;
    }
  }

  if (blocks.length > 0) {
    body += '<section><h2>💡 AI Comments</h2>';
    body += _renderFileBlocks(blocks, repoRoot, pal);
    body += '</section>';
  }

  if (report.staged_files.length > 0) {
    body += '<section><h2>📁 Analyzed File List</h2><ul class="file-list">';
    for (const f of report.staged_files) {
      const absFile = path.join(repoRoot, f);
      body += `<li><a class="file-link" data-path="${esc(absFile)}" data-line="1" href="#"><code>${esc(f)}</code></a></li>`;
    }
    body += '</ul></section>';
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {
    --radius: 6px;
    --cd-p3: ${pal.priority.P3};
    --cd-p2: ${pal.priority.P2};
    --cd-p1: ${pal.priority.P1};
    --cd-p0: ${pal.priority.P0};
    --cd-cat-security:        ${pal.category.security};
    --cd-cat-correctness:     ${pal.category.correctness};
    --cd-cat-maintenance:     ${pal.category.maintenance};
    --cd-cat-optimization:    ${pal.category.optimization};
    --cd-cat-setting:         ${pal.category.setting};
    --cd-cat-review-history:  ${pal.category['review-history']};
  }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 32px;
    line-height: 1.65;
    max-width: 960px;
  }
  h1 { font-size: 1.3em; margin: 0 0 6px; }
  h2 { font-size: 1em; font-weight: 600; margin: 1.8em 0 0.6em;
       border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 4px; }
  a  { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    font-family: var(--vscode-editor-font-family);
    background: var(--vscode-textBlockQuote-background);
    padding: 1px 5px; border-radius: 3px; font-size: 0.88em;
  }
  .header { margin-bottom: 1.4em; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 4px; }
  .badge {
    display: inline-block; padding: 2px 12px; border-radius: 4px;
    font-size: 0.78em; font-weight: 700; margin-left: 8px; vertical-align: middle;
  }
  .badge.pass    { background: #2d7d46; color: #fff; }
  .badge.blocked { background: var(--vscode-statusBarItem-errorBackground, #c72e2e); color: #fff; }
  .mode-tag { display: inline-block; font-size: 0.78em; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); vertical-align: middle; }
  .file-block { margin-bottom: 1.2em; }
  .file-name { font-size: 0.88em; font-weight: 600; margin-bottom: 4px; color: var(--vscode-descriptionForeground); }
  .suggestion {
    background: var(--vscode-textBlockQuote-background);
    border-left: 3px solid var(--vscode-textLink-foreground);
    border-radius: 0 var(--radius) var(--radius) 0;
    padding: 8px 14px; margin: 5px 0;
  }
  .suggestion-header { font-size: 0.85em; margin-bottom: 5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .priority-badge { font-weight: 600; white-space: nowrap; }
  .suggestion.priority-P3 { border-left: 3px solid var(--cd-p3); padding-left: 8px; }
  .suggestion.priority-P2 { border-left: 3px solid var(--cd-p2); padding-left: 8px; }
  .suggestion.priority-P1 { border-left: 3px solid var(--cd-p1); padding-left: 8px; }
  .suggestion.priority-P0 { border-left: 3px solid var(--cd-p0); padding-left: 8px; }
  .suggestion-body p { margin: 4px 0; }
  .line-label { color: var(--vscode-descriptionForeground); font-size: 0.82em; }
  .cat {
    display: inline-block; font-size: 0.72em; font-weight: 600;
    padding: 1px 6px; border-radius: 3px; margin-left: 6px;
    vertical-align: middle; text-transform: uppercase;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  .cat-security       { background: var(--cd-cat-security);        color: #fff; }
  .cat-correctness    { background: var(--cd-cat-correctness);     color: #fff; }
  .cat-maintenance    { background: var(--cd-cat-maintenance);     color: #fff; }
  .cat-optimization   { background: var(--cd-cat-optimization);    color: #fff; }
  .cat-setting        { background: var(--cd-cat-setting);         color: #fff; }
  .cat-review-history { background: var(--cd-cat-review-history);  color: #fff; }
  .file-list { margin: 4px 0; padding-left: 20px; }
  .file-list li { margin: 2px 0; font-size: 0.88em; }
  .summary-text p { margin: 6px 0; }
  .per-file-summary {
    padding: 10px 0;
    border-bottom: 1px solid var(--vscode-widget-border);
  }
  .per-file-summary:last-child { border-bottom: none; }
  .per-file-header {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 6px; flex-wrap: wrap;
  }
  .per-file-header code {
    font-size: 0.9em;
    background: var(--vscode-textBlockQuote-background);
  }
  .per-file-body p { margin: 4px 0; }
  .summary-error {
    background: var(--vscode-inputValidation-errorBackground, rgba(199,46,46,0.15));
    border-left: 3px solid var(--vscode-errorForeground);
    border-radius: 0 var(--radius) var(--radius) 0;
    padding: 10px 14px;
  }
  section { margin-bottom: 1.6em; }
  .header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .header-row h1 { margin: 0; flex: 1; }
  .json-btn {
    cursor: pointer;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.78em;
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
    background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    white-space: nowrap;
  }
  .json-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
</style>
</head>
<body>
${body}
<script>
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', e => {
    const link = e.target.closest('a[data-path]');
    if (link) {
      e.preventDefault();
      vscode.postMessage({
        command: 'open',
        path: link.dataset.path,
        line: parseInt(link.dataset.line || '1', 10),
      });
      return;
    }
    if (e.target && e.target.id === 'btnShowJson') {
      vscode.postMessage({ command: 'showJson' });
    }
  });
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mdToHtml(md: string): string {
  const inline = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`([^`]+)`/g,     '<code>$1</code>');

  const blocks = md.split(/\n{2,}/);
  return blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) { return ''; }

    if (trimmed.startsWith('### ')) { return `<h4>${inline(trimmed.slice(4))}</h4>`; }
    if (trimmed.startsWith('## '))  { return `<h3>${inline(trimmed.slice(3))}</h3>`; }
    if (trimmed.startsWith('# '))   { return `<h2>${inline(trimmed.slice(2))}</h2>`; }
    if (trimmed === '---')           { return '<hr>'; }

    const lines = trimmed.split('\n');
    if (lines.every(l => l.trimStart().startsWith('- '))) {
      const items = lines.map(l => `<li>${inline(l.trimStart().slice(2))}</li>`).join('');
      return `<ul>${items}</ul>`;
    }

    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).filter(Boolean).join('');
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
