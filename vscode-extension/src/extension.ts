import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SuggestionCodeLensProvider } from './codeLens.js';
import { CommentManager } from './comments.js';
import { ExtensionConfig, getConfig } from './config.js';
import { applyDiagnostics } from './diagnostics.js';
import { findingsStore } from './findingsStore.js';
import { collectFiles, getRepoRoot, getStagedFiles, filterForAnalysis } from './gitHelper.js';
import { ensurePackageInstalled, ensurePreCommitHook, uninstallPreCommitHook } from './installer.js';
import { HistoryProvider } from './historyProvider.js';
import { getOutputChannel, disposeOutputChannel } from './outputChannel.js';
import { PythonRunner } from './runner.js';
import { StatusBarManager } from './statusBar.js';
import { AnalysisReport, CommentBlock, PRIORITY_META } from './types.js';
import { normalizeReport, worstPriority, metaForBlock, formatCategory } from './commentFormatter.js';

const ALL_FILES: vscode.DocumentSelector = { scheme: 'file' };


export function activate(context: vscode.ExtensionContext): void {
  const extensionVersion: string = context.extension.packageJSON?.version ?? '0.1.0';
  const cfg = getConfig();
  // Keep the promise so analysis commands can await it — instant if already resolved.
  const backendReady = ensurePackageInstalled(cfg.pythonExecutable, extensionVersion, context)
    .catch(() => { /* failure already reported inside ensurePackageInstalled */ });

  // ── Helper: resolve repo root for hook commands ───────────────────────────
  async function resolveRepoRoot(): Promise<string | undefined> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { return undefined; }
    try { return await getRepoRoot(ws); } catch { return undefined; }
  }

  // ── Install Pre-commit Hook command ───────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.installPreCommitHook',
    async () => {
      const repoRoot = await resolveRepoRoot();
      if (!repoRoot) {
        vscode.window.showWarningMessage('Commit Defender: No git repository found in workspace.');
        return;
      }
      await backendReady;
      await ensurePreCommitHook(getConfig().pythonExecutable, repoRoot);
    },
  ));

  // ── Uninstall Pre-commit Hook command ─────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.uninstallPreCommitHook',
    async () => {
      const repoRoot = await resolveRepoRoot();
      if (!repoRoot) {
        vscode.window.showWarningMessage('Commit Defender: No git repository found in workspace.');
        return;
      }
      await uninstallPreCommitHook(getConfig().pythonExecutable, repoRoot);
    },
  ));

  // ── React to preCommitHook setting changes ────────────────────────────────
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('commitDefender.preCommitHook')) {
      const hook = getConfig().preCommitHook;
      if (hook === 'enable') {
        vscode.commands.executeCommand('commitDefender.installPreCommitHook');
      } else {
        vscode.commands.executeCommand('commitDefender.uninstallPreCommitHook');
      }
    }
  }));

  // ── On activation: install hook if already enabled ────────────────────────
  if (cfg.preCommitHook === 'enable') {
    backendReady.then(() =>
      vscode.commands.executeCommand('commitDefender.installPreCommitHook')
    );
  }

  const diagnostics   = vscode.languages.createDiagnosticCollection('commit-defender');
  const commentCtrl   = vscode.comments.createCommentController('commit-defender', 'Commit Defender');
  const commentManager = new CommentManager();
  const statusBar     = new StatusBarManager();
  let currentRunner: PythonRunner | null = null;
  const codeLensProvider = new SuggestionCodeLensProvider();
  const historyProvider  = new HistoryProvider();
  const historyView = vscode.window.createTreeView('commitDefender.history', {
    treeDataProvider: historyProvider,
    showCollapseAll: false,
  });

  context.subscriptions.push(
    diagnostics,
    commentCtrl,
    statusBar.item,
    historyView,
    vscode.languages.registerCodeLensProvider(ALL_FILES, codeLensProvider),
  );

  // ── Helper: shared analysis pipeline ──────────────────────────────────────
  // repoRoot must be the NON-resolved path (e.g. /Users/… not /private/Users/…)
  // so that VS Code URIs built from it match open editor documents.
  async function analyze(relPaths: string[], repoRoot: string): Promise<void> {
    await backendReady;   // no-op if already resolved; waits on first-install/upgrade
    const cfg = getConfig();
    const timeoutSeconds = relPaths.length === 1
      ? cfg.fileTimeoutSeconds
      : cfg.directoryTimeoutSeconds;

    const runner = new PythonRunner(cfg, (current, total, file) => {
      statusBar.setProgress(current, total, file);
    });
    currentRunner = runner;
    const result = await runner.runTargets(repoRoot, relPaths, timeoutSeconds);
    currentRunner = null;

    if (result.cancelled) {
      statusBar.setIdle('Analysis cancelled');
      vscode.window.showInformationMessage('Commit Defender: Analysis cancelled.');
      return;
    }

    if (result.timedOut) {
      statusBar.setIdle('Analysis timed out');
      vscode.window.showWarningMessage(`Commit Defender: Analysis timed out after ${timeoutSeconds}s.`);
      return;
    }

    if (result.report.staged_files.length === 0) {
      statusBar.setIdle('No files analyzed');
      const summary = result.report.review?.summary ?? 'No files matched for analysis.';
      const channel = getOutputChannel();
      channel.show(true);
      vscode.window.showInformationMessage(`Commit Defender: ${summary} Check the output panel for details.`);
      return;
    }

    findingsStore.update(result.report, repoRoot);
    historyProvider.push(result.report, repoRoot);
    const blocks = findingsStore.lastReport()!.blocks;
    applyDiagnostics(blocks, repoRoot, diagnostics);
    commentManager.apply(blocks, repoRoot, commentCtrl);

    const passed = result.report.exit_code === 0;
    statusBar.setResult(passed, result.report.review.grade);

    // Notify the user when the AI review failed (auth error, network issue, etc.)
    if (result.report.review.is_error) {
      const msg = result.report.review.summary.replace(/^AI review unavailable:\s*/i, '');
      vscode.window.showErrorMessage(`Commit Defender: AI review failed — ${msg}`, 'Show Summary', 'Show Output').then(action => {
        if (action === 'Show Summary') { showSummaryPanel(result.report, repoRoot, context, cfg.analysisMode); }
        else if (action === 'Show Output') { getOutputChannel().show(); }
      });
    }

    // Open the summary webview in the editor — this is the "total summary" panel.
    showSummaryPanel(result.report, repoRoot, context, cfg.analysisMode);

    // Focus the Problems panel so the user sees diagnostics immediately.
    vscode.commands.executeCommand('workbench.panel.markers.view.focus');
  }

  // ── 1. Analyze Current File ────────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.analyzeCurrentFile',
    async (uri?: vscode.Uri) => {
      // When invoked from Explorer context menu, uri is the right-clicked file.
      // When invoked from command palette or editor title, fall back to active editor.
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

        // Resolve both paths only for computing path.relative() — this handles
        // the macOS /Users → /private/Users symlink mismatch. Then pass rawRoot
        // (unresolved) to analyze() so VS Code URIs match open editor documents.
        let resolvedRoot = rawRoot;
        let resolvedFile = filePath;
        try {
          resolvedRoot = fs.realpathSync(rawRoot);
          resolvedFile = fs.realpathSync(filePath);
        } catch { /* fall back to originals */ }

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

        await analyze([relPath], rawRoot);
      } catch (err) {
        handleError(err, statusBar);
      }
    }
  ));

  // ── 2. Analyze Directory ───────────────────────────────────────────────────
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

      // When invoked from Explorer context menu, uri is the right-clicked folder.
      // When invoked from command palette, show the directory picker.
      const dirPath = (uri?.scheme === 'file') ? uri.fsPath : await pickDirectory(rawRoot);
      if (!dirPath) { return; }

      statusBar.setRunning();
      try {
        const relPaths = collectFiles(dirPath, rawRoot);
        if (relPaths.length === 0) {
          statusBar.setIdle('No supported files found');
          vscode.window.showInformationMessage('Commit Defender: No analyzable files found in that directory.');
          return;
        }

        const channel = getOutputChannel();
        channel.appendLine(`\n[Commit Defender] Analyze Directory: ${path.relative(rawRoot, dirPath) || '.'}`);
        channel.appendLine(`  ${relPaths.length} file(s) found`);

        await analyze(relPaths, rawRoot);
      } catch (err) {
        handleError(err, statusBar);
      }
    }
  ));

  // ── 3. Analyze Staged Files ────────────────────────────────────────────────
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

        const staged = await getStagedFiles(rawRoot);
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
          // 'Proceed to Analyze' → fall through
        }

        const channel = getOutputChannel();
        channel.appendLine(`\n[Commit Defender] Analyze Staged Files: ${staged.length} file(s)`);

        await analyze(staged, rawRoot);
      } catch (err) {
        handleError(err, statusBar);
      }
    }
  ));

  // ── 4. Analyze Repository ──────────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.analyzeRepository',
    async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) { return; }

      statusBar.setRunning();
      try {
        const cfg = getConfig();
        const rawRoot = await getRepoRoot(ws);
        const allFiles = collectFiles(rawRoot, rawRoot);
        if (allFiles.length === 0) {
          statusBar.setIdle('No files found');
          vscode.window.showInformationMessage('Commit Defender: No analyzable files found in the repository.');
          return;
        }

        // Warn and confirm if the repo is large
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

        await analyze(allFiles, rawRoot);
      } catch (err) {
        handleError(err, statusBar);
      }
    }
  ));

  // ── Cancel running analysis ────────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand('commitDefender.cancel', () => {
    if (currentRunner) {
      currentRunner.cancel();
      currentRunner = null;
      statusBar.setIdle('Analysis cancelled');
    }
  }));

  // ── Clear findings ─────────────────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand('commitDefender.clearFindings', () => {
    diagnostics.clear();
    commentManager.clearAll();
    findingsStore.clear();
    historyProvider.clear();
    statusBar.setIdle();
  }));

  // ── Show line suggestion (CodeLens click) — navigate to line ─────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.showLineSuggestion',
    async (uri: vscode.Uri, line0: number) => {
      await vscode.window.showTextDocument(uri, {
        selection:     new vscode.Range(line0, 0, line0, 0),
        preserveFocus: false,
      });
    }
  ));

  // ── Show summary panel (manual re-open) ───────────────────────────────────
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

  // ── Show history entry ─────────────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.showHistoryEntry',
    (entry: import('./historyProvider.js').HistoryEntry) => {
      showSummaryPanel(entry.report, entry.repoRoot, context);
    }
  ));

  // ── Re-analyze history entry ───────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.reanalyzeHistoryEntry',
    async (entry: import('./historyProvider.js').HistoryEntry) => {
      if (!entry?.report.staged_files.length) {
        vscode.window.showWarningMessage('Commit Defender: No files recorded for this history entry.');
        return;
      }
      statusBar.setRunning();
      try {
        await analyze(entry.report.staged_files, entry.repoRoot);
      } catch (err) {
        handleError(err, statusBar);
      }
    }
  ));

  // ── Auto-trigger on git stage ──────────────────────────────────────────────
  setupIndexWatcher(context);
}

export function deactivate(): void {
  findingsStore.clear();
  disposeOutputChannel();
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
  analysisMode?: string,
): void {
  // Create or reuse panel — always beside the active editor, non-stealing focus
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

    // Handle file-open messages from clickable links in the webview
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
  _summaryPanel.webview.html = buildSummaryHtml(report, repoRoot, analysisMode);
}


function gradeColor(grade: string): string {
  switch (grade) {
    case 'exceptional':  return '#2d7d46';
    case 'proficient':   return '#1a7a4a';
    case 'adequate':     return '#b07d00';
    case 'insufficient': return '#c05c00';
    case 'critical':     return '#c72e2e';
    default:             return '#666';
  }
}

function buildSummaryHtml(report: AnalysisReport, repoRoot: string, analysisMode?: string): string {
  // ── Normalize to unified CommentBlock[] — single source of truth ─────────
  const blocks  = normalizeReport(report);
  const passed  = report.exit_code === 0;
  const grade   = report.review.grade;
  const isError = report.review.is_error || report.review.summary.startsWith('AI review unavailable');
  const isRuleBased = analysisMode === 'rule-based'
    || (!analysisMode && !grade && report.review.file_comments.length === 0 && !isError);

  // Overall worst p-level across all blocks
  const wp     = worstPriority(blocks);
  const wpMeta = wp ? PRIORITY_META[wp] : undefined;

  const headerBadge = isError
    ? '<span class="badge" style="background:#888">AI ERROR ⚠</span>'
    : passed ? '<span class="badge pass">PASS ✓</span>'
             : '<span class="badge blocked">BLOCKED ✗</span>';
  const gradeBadge = grade
    ? `<span class="badge" style="background:${gradeColor(grade)}">${grade.toUpperCase()}</span>`
    : '';
  const worstBadge = wpMeta
    ? `<span class="priority-badge" style="color:${wpMeta.color}">${wpMeta.emoji} ${wp} ${wpMeta.label}</span>`
    : '';

  // ── Header ────────────────────────────────────────────────────────────────
  let body = `
    <div class="header">
      <div class="header-row">
        <h1>🛡 Commit Defender &nbsp;${headerBadge} ${gradeBadge} &nbsp;${worstBadge}</h1>
        <button class="json-btn" id="btnShowJson" title="Open raw JSON report in editor">{ } Raw JSON</button>
      </div>
      <div class="meta">
        ${report.staged_files.length} file(s) &nbsp;·&nbsp; ${blocks.length} finding(s) &nbsp;·&nbsp;
        ${isError
          ? '<span class="mode-tag" style="background:#c72e2e">ai error</span>'
          : `<span class="mode-tag">${isRuleBased ? 'rule-based' : (analysisMode ?? 'hybrid')}</span>`
        } &nbsp;·&nbsp; ${report.duration_ms} ms
      </div>
    </div>`;

  // ── Overall summary text ──────────────────────────────────────────────────
  if (isRuleBased) {
    const e = report.lint_findings.filter(f => f.severity === 'error').length;
    const w = report.lint_findings.filter(f => f.severity === 'warning').length;
    const txt = blocks.length === 0
      ? '✅ No lint issues found.'
      : `Linter found ${[e > 0 && `${e} error${e > 1 ? 's' : ''}`, w > 0 && `${w} warning${w > 1 ? 's' : ''}`].filter(Boolean).join(', ')}.`;
    body += `<section><h2>📋 Linter Summary</h2><div class="summary-text">${txt}</div></section>`;
  } else if (report.review.summary) {
    const cls = isError ? 'summary-error' : 'summary-text';
    const txt = isError
      ? report.review.summary.replace(/^AI review unavailable:\s*/i, '')
      : report.review.summary;
    body += `<section><h2>${isError ? '⚠ AI Review Error' : '📋 Overall Summary'}</h2>
      <div class="${cls}">${mdToHtml(txt)}</div></section>`;
  }

  // ── Per-file findings (all blocks unified, sorted worst-first) ────────────
  if (blocks.length > 0) {
    const byFile = new Map<string, CommentBlock[]>();
    for (const b of blocks) {
      const list = byFile.get(b.file) ?? [];
      list.push(b);
      byFile.set(b.file, list);
    }

    body += '<section><h2>🔍 Analysis Findings</h2>';
    for (const [relFile, fileBlocks] of byFile) {
      const absFile = path.join(repoRoot, relFile);
      body += `<div class="file-block">
        <div class="file-name">
          <a class="file-link" data-path="${esc(absFile)}" data-line="1" href="#">${esc(relFile)}</a>
        </div>`;
      for (const b of fileBlocks) {
        const meta    = metaForBlock(b);
        const cat     = formatCategory(b.category);
        const srcTag  = `<span class="source-tag ${b.source}">${b.source}</span>`;
        const pBadge  = `<span class="priority-badge" style="color:${meta.color}">${meta.emoji} ${b.priority} ${meta.label}</span>`;
        const lineRef = b.line > 0
          ? `<a class="line-link" data-path="${esc(absFile)}" data-line="${b.line}" href="#">line ${b.line}</a>`
          : '<span class="line-label">file-level</span>';
        const bodyHtml = b.source === 'lint' && b.rule
          ? `<code>${esc(b.rule)}</code> ${esc(b.comment)}`
          : mdToHtml(b.comment);
        body += `<div class="suggestion priority-${esc(b.priority)}">
          <div class="suggestion-header">
            <span class="suggestion-category">${esc(cat)}:</span> ${pBadge} ${srcTag} &nbsp;${lineRef}
          </div>
          <div class="suggestion-body">${bodyHtml}</div>
        </div>`;
      }
      body += '</div>';
    }
    body += '</section>';
  }

  // ── Analyzed files list ───────────────────────────────────────────────────
  if (report.staged_files.length > 0) {
    body += '<section><h2>📁 Analyzed Files</h2><ul class="file-list">';
    for (const f of report.staged_files) {
      const absFile = path.join(repoRoot, f);
      body += `<li><a class="file-link" data-path="${esc(absFile)}" data-line="1" href="#">${esc(f)}</a></li>`;
    }
    body += '</ul></section>';
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { --radius: 6px; }
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
  .suggestion-category { font-weight: 700; color: var(--vscode-foreground); }
  .priority-badge { font-weight: 600; white-space: nowrap; }
  .suggestion.priority-P3 { border-left: 3px solid #ef4444; padding-left: 8px; }
  .suggestion.priority-P2 { border-left: 3px solid #f97316; padding-left: 8px; }
  .suggestion.priority-P1 { border-left: 3px solid #3b82f6; padding-left: 8px; }
  .suggestion.priority-P0 { border-left: 3px solid #22c55e; padding-left: 8px; }
  .suggestion-body p { margin: 4px 0; }
  .line-label { color: var(--vscode-descriptionForeground); font-size: 0.82em; }
  .cat {
    display: inline-block; font-size: 0.72em; font-weight: 600;
    padding: 1px 6px; border-radius: 3px; margin-left: 6px;
    vertical-align: middle; text-transform: uppercase;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  .cat-security    { background: #c72e2e; color: #fff; }
  .cat-correctness { background: #b5540b; color: #fff; }
  .cat-maintenance { background: #0066b8; color: #fff; }
  .cat-optimization{ background: #5a2d8a; color: #fff; }
  .cat-setting     { background: #2d7d46; color: #fff; }
  .lint-list { margin: 4px 0; padding-left: 20px; }
  .lint-list li { margin: 3px 0; font-size: 0.9em; }
  .sev-error   { color: var(--vscode-errorForeground);           font-weight: 700; margin: 0 4px; }
  .sev-warning { color: var(--vscode-editorWarning-foreground);  font-weight: 600; margin: 0 4px; }
  .sev-info    { color: var(--vscode-editorInfo-foreground);     margin: 0 4px; }
  .file-list { margin: 4px 0; padding-left: 20px; }
  .file-list li { margin: 2px 0; font-size: 0.88em; }
  .summary-text p { margin: 6px 0; }
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
  .source-tag { display:inline-block; font-size:0.7em; font-weight:700; padding:1px 5px; border-radius:3px; vertical-align:middle; text-transform:uppercase; }
  .source-tag.lint { background:#b5540b; color:#fff; }
  .source-tag.ai   { background:#0066b8; color:#fff; }
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

function createWebviewPanel(title: string, context: vscode.ExtensionContext): vscode.WebviewPanel {
  if (_summaryPanel) {
    _summaryPanel.title = title;
    _summaryPanel.reveal(vscode.ViewColumn.Beside, true);
    return _summaryPanel;
  }
  _summaryPanel = vscode.window.createWebviewPanel(
    'commitDefenderSummary', title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true },
  );
  _summaryPanel.onDidDispose(() => { _summaryPanel = undefined; }, null, context.subscriptions);
  return _summaryPanel;
}

function wrapHtml(body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
         color: var(--vscode-foreground); background: var(--vscode-editor-background);
         padding: 20px 28px; line-height: 1.65; max-width: 900px; }
  h2   { font-size: 1.05em; margin: 1.8em 0 0.6em;
         border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 4px; }
  code { font-family: var(--vscode-editor-font-family);
         background: var(--vscode-textBlockQuote-background);
         padding: 1px 5px; border-radius: 3px; font-size: 0.9em; }
  .suggestion { background: var(--vscode-textBlockQuote-background);
                border-left: 3px solid var(--vscode-textLink-foreground);
                border-radius: 0 6px 6px 0; padding: 8px 14px; margin: 6px 0; }
  .lint-list { margin: 4px 0; padding-left: 18px; }
  .lint-list li { margin: 3px 0; }
  .sev-error   { color: var(--vscode-errorForeground); font-weight: 600; margin: 0 4px; }
  .sev-warning { color: var(--vscode-editorWarning-foreground); font-weight: 600; margin: 0 4px; }
  .sev-info    { color: var(--vscode-editorInfo-foreground); margin: 0 4px; }
</style></head><body>${body}</body></html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mdToHtml(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm,  '<h3>$1</h3>')
    .replace(/^# (.+)$/gm,   '<h2>$1</h2>')
    .replace(/^---$/gm,      '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,    '<em>$1</em>')
    .replace(/`([^`]+)`/g,    '<code>$1</code>')
    .replace(/^- (.+)$/gm,    '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/(.+)/s, '<p>$1</p>');
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
