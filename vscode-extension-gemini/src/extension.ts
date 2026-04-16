import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SuggestionCodeLensProvider } from './codeLens.js';
import { CommentManager } from './comments.js';
import { ExtensionConfig, getConfig } from './config.js';
import { applyDiagnostics } from './diagnostics.js';
import { findingsStore } from './findingsStore.js';
import { collectFiles, getRepoRoot, getStagedFiles, filterForAnalysis } from './gitHelper.js';
import { ensurePackageInstalled } from './installer.js';
import { SuggestionHoverProvider } from './hoverProvider.js';
import { HistoryProvider } from './historyProvider.js';
import { getOutputChannel, disposeOutputChannel } from './outputChannel.js';
import { PythonRunner } from './runner.js';
import { StatusBarManager } from './statusBar.js';
import { AnalysisReport } from './types.js';

const ALL_FILES: vscode.DocumentSelector = { scheme: 'file' };

// Max files before asking the user to confirm for repo-wide analysis
const REPO_ANALYSIS_WARN_THRESHOLD = 80;

export function activate(context: vscode.ExtensionContext): void {
  const extensionVersion: string = context.extension.packageJSON?.version ?? '0.1.0';
  const cfg = getConfig();
  ensurePackageInstalled(cfg.pythonExecutable, extensionVersion, context).catch(() => {});

  const diagnostics = vscode.languages.createDiagnosticCollection('commit-defender');
  const commentCtrl = vscode.comments.createCommentController('commit-defender', 'AI Comments');
  const statusBar = new StatusBarManager();
  const commentManager = new CommentManager();
  const codeLensProvider = new SuggestionCodeLensProvider();
  const hoverProvider = new SuggestionHoverProvider();
  const historyProvider = new HistoryProvider();
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
    vscode.languages.registerHoverProvider(ALL_FILES, hoverProvider),
  );

  // ── Helper: shared analysis pipeline ──────────────────────────────────────
  // repoRoot must be the NON-resolved path (e.g. /Users/… not /private/Users/…)
  // so that VS Code URIs built from it match open editor documents.
  async function analyze(relPaths: string[], repoRoot: string): Promise<void> {
    const cfg = getConfig();
    const runner = new PythonRunner(cfg, (current, total, file) => {
      statusBar.setProgress(current, total, file);
    });
    const result = await runner.runTargets(repoRoot, relPaths);

    if (result.timedOut) {
      statusBar.setError('Analysis timed out');
      vscode.window.showErrorMessage(`Commit Defender: Analysis timed out after ${cfg.timeoutSeconds}s.`);
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
    applyDiagnostics(result.report, repoRoot, diagnostics);
    commentManager.apply(result.report, repoRoot, commentCtrl);

    const passed = result.report.exit_code === 0;
    statusBar.setResult(passed, result.report.review.grade);

    // Open the summary webview in the editor — this is the "total summary" panel.
    showSummaryPanel(result.report, repoRoot, context);

    // Also focus the Comments panel so inline threads are visible.
    vscode.commands.executeCommand('workbench.panel.comments.view.focus');
  }

  // ── 1. Analyze Current File ────────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.analyzeCurrentFile',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== 'file') {
        vscode.window.showWarningMessage('Commit Defender: Open a file in the editor first.');
        return;
      }

      const filePath = editor.document.uri.fsPath;
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
    async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) { return; }

      let rawRoot: string;
      try {
        rawRoot = await getRepoRoot(ws);
      } catch (err) {
        handleError(err, statusBar);
        return;
      }

      const dirPath = await pickDirectory(rawRoot);
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
        const rawRoot = await getRepoRoot(ws);
        const allFiles = collectFiles(rawRoot, rawRoot);
        if (allFiles.length === 0) {
          statusBar.setIdle('No files found');
          vscode.window.showInformationMessage('Commit Defender: No analyzable files found in the repository.');
          return;
        }

        // Warn and confirm if the repo is large
        if (allFiles.length > REPO_ANALYSIS_WARN_THRESHOLD) {
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

  // ── Clear findings ─────────────────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand('commitDefender.clearFindings', () => {
    diagnostics.clear();
    commentManager.clearAll();
    findingsStore.clear();
    historyProvider.clear();
    statusBar.setIdle();
  }));

  // ── Show line suggestion (CodeLens click) ──────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand(
    'commitDefender.showLineSuggestion',
    (uri: vscode.Uri, line0: number) => {
      const set = findingsStore.get(uri);
      if (!set) { return; }

      const aiComments = set.commentByLine.get(line0) ?? [];
      const lintFindings = set.lintByLine.get(line0) ?? [];
      if (!aiComments.length && !lintFindings.length) { return; }

      const panel = createWebviewPanel(`Line ${line0 + 1} — Suggestions`, context);
      let html = `<h2>Line ${line0 + 1}</h2>`;
      if (aiComments.length) {
        html += '<h3>💡 AI Suggestions</h3>';
        html += aiComments.map(c => `<div class="suggestion">${mdToHtml(c.comment)}</div>`).join('');
      }
      if (lintFindings.length) {
        html += '<h3>⚠ Lint Findings</h3><ul class="lint-list">';
        html += lintFindings.map(f =>
          `<li><span class="sev-${esc(f.severity)}">${esc(f.severity)}</span> ` +
          `<code>${esc(f.rule)}</code> ${esc(f.message)}</li>`
        ).join('');
        html += '</ul>';
      }
      panel.webview.html = wrapHtml(html);
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
  _summaryPanel.webview.html = buildSummaryHtml(report, repoRoot);
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

function buildSummaryHtml(report: AnalysisReport, repoRoot: string): string {
  const passed = report.exit_code === 0;
  const grade = report.review.grade;
  const gradeBadge = grade
    ? `<span class="badge" style="background:${gradeColor(grade)}">${grade.toUpperCase()}</span>`
    : '';
  const statusBadge = passed
    ? '<span class="badge pass">PASS ✓</span>'
    : '<span class="badge blocked">BLOCKED ✗</span>';
  const isError = report.review.is_error;

  // ── Header ──────────────────────────────────────────────────────────────────
  let body = `
    <div class="header">
      <div class="header-row">
        <h1>🛡 Commit Defender &nbsp;${statusBadge} ${gradeBadge}</h1>
        <button class="json-btn" id="btnShowJson" title="Open raw JSON report in editor">{ } Raw JSON</button>
      </div>
      <div class="meta">
        ${report.staged_files.length} file(s) analyzed &nbsp;·&nbsp;
        ${report.lint_findings.length} lint finding(s) &nbsp;·&nbsp;
        ${report.review.file_comments.length} AI suggestion(s) &nbsp;·&nbsp;
        ${report.duration_ms} ms
      </div>
    </div>`;

  // ── AI Overall Summary ───────────────────────────────────────────────────────
  if (report.review.summary) {
    const summaryClass = isError ? 'summary-error' : 'summary-text';
    body += `
    <section>
      <h2>${isError ? '⚠ AI Review Error' : '📋 Overall Summary'}</h2>
      <div class="${summaryClass}">${mdToHtml(report.review.summary)}</div>
    </section>`;
  }

  // ── AI Suggestions per file ──────────────────────────────────────────────────
  if (report.review.file_comments.length > 0) {
    const byFile = new Map<string, typeof report.review.file_comments>();
    for (const fc of report.review.file_comments) {
      const list = byFile.get(fc.file) ?? [];
      list.push(fc);
      byFile.set(fc.file, list);
    }

    body += '<section><h2>💡 AI Suggestions</h2>';
    for (const [relFile, comments] of byFile) {
      const absFile = path.join(repoRoot, relFile);
      body += `<div class="file-block">
        <div class="file-name">
          <a class="file-link" data-path="${esc(absFile)}" data-line="1" href="#">${esc(relFile)}</a>
        </div>`;
      for (const fc of comments) {
        const catBadge = fc.category ? `<span class="cat cat-${esc(fc.category)}">${esc(fc.category)}</span>` : '';
        const lineRef = fc.line > 0
          ? `<a class="line-link" data-path="${esc(absFile)}" data-line="${fc.line}" href="#">line ${fc.line}</a>`
          : '<span class="line-label">file-level</span>';
        body += `<div class="suggestion">
          <div class="suggestion-meta">${lineRef} ${catBadge}</div>
          <div class="suggestion-body">${mdToHtml(fc.comment)}</div>
        </div>`;
      }
      body += '</div>';
    }
    body += '</section>';
  }

  // ── Lint Findings per file ───────────────────────────────────────────────────
  if (report.lint_findings.length > 0) {
    const byFile = new Map<string, typeof report.lint_findings>();
    for (const f of report.lint_findings) {
      const list = byFile.get(f.file) ?? [];
      list.push(f);
      byFile.set(f.file, list);
    }

    body += '<section><h2>⚠ Lint Findings</h2>';
    for (const [relFile, findings] of byFile) {
      const absFile = path.join(repoRoot, relFile);
      body += `<div class="file-block">
        <div class="file-name">
          <a class="file-link" data-path="${esc(absFile)}" data-line="1" href="#">${esc(relFile)}</a>
        </div>
        <ul class="lint-list">`;
      for (const f of findings) {
        body += `<li>
          <a class="line-link" data-path="${esc(absFile)}" data-line="${f.line}" href="#">line ${f.line}</a>
          <span class="sev-${esc(f.severity)}">${esc(f.severity)}</span>
          <code>${esc(f.rule)}</code> ${esc(f.message)}
        </li>`;
      }
      body += '</ul></div>';
    }
    body += '</section>';
  }

  // ── Analyzed files list ──────────────────────────────────────────────────────
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
  .file-block { margin-bottom: 1.2em; }
  .file-name { font-size: 0.88em; font-weight: 600; margin-bottom: 4px; color: var(--vscode-descriptionForeground); }
  .suggestion {
    background: var(--vscode-textBlockQuote-background);
    border-left: 3px solid var(--vscode-textLink-foreground);
    border-radius: 0 var(--radius) var(--radius) 0;
    padding: 8px 14px; margin: 5px 0;
  }
  .suggestion-meta { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
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
