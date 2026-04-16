import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig } from './config.js';
import { applyDiagnostics } from './diagnostics.js';
import { CommentManager } from './comments.js';
import { getRepoRoot, getStagedFiles } from './gitHelper.js';
import { getOutputChannel, disposeOutputChannel } from './outputChannel.js';
import { createRunner } from './runner.js';
import { StatusBarManager } from './statusBar.js';

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('commit-defender');
  const commentCtrl = vscode.comments.createCommentController(
    'commit-defender',
    'Commit Defender'
  );
  const statusBar = new StatusBarManager();
  const commentManager = new CommentManager();

  context.subscriptions.push(diagnostics, commentCtrl, statusBar.item);

  // ── Main analyze command ────────────────────────────────────────────────────
  const analyzeCmd = vscode.commands.registerCommand(
    'commitDefender.analyze',
    async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) {
        vscode.window.showWarningMessage('Commit Defender: No workspace folder open.');
        return;
      }

      statusBar.setRunning();

      try {
        const repoRoot = await getRepoRoot(ws);
        const staged = await getStagedFiles(repoRoot);

        if (staged.length === 0) {
          statusBar.setIdle('No staged files');
          vscode.window.showInformationMessage('Commit Defender: No staged files to analyze.');
          return;
        }

        const cfg = getConfig();
        const runner = createRunner(cfg);
        const result = await runner.run(repoRoot, staged);

        if (result.timedOut) {
          statusBar.setError('Analysis timed out');
          vscode.window.showErrorMessage(
            `Commit Defender: Analysis timed out after ${cfg.timeoutSeconds}s.`
          );
          return;
        }

        // Apply findings to editor
        applyDiagnostics(result.report, repoRoot, diagnostics);
        commentManager.apply(result.report, repoRoot, commentCtrl);

        const passed = result.report.exit_code === 0;
        statusBar.setResult(passed);

        const findingCount = result.report.lint_findings.length;
        const label = passed ? 'PASS ✓' : 'BLOCKED ✗';
        const msg = `Commit Defender: ${label} — ${findingCount} lint finding(s), ${result.report.duration_ms}ms`;

        const action = await vscode.window.showInformationMessage(msg, 'Show Output', 'Show Summary');

        if (action === 'Show Output') {
          getOutputChannel().show();
        } else if (action === 'Show Summary') {
          showSummaryPanel(result.report.review.summary, context);
        }

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        statusBar.setError(message);
        vscode.window.showErrorMessage(`Commit Defender: ${message}`);
        getOutputChannel().appendLine(`\n[Error] ${message}`);
      }
    }
  );

  // ── Clear findings command ──────────────────────────────────────────────────
  const clearCmd = vscode.commands.registerCommand('commitDefender.clearFindings', () => {
    diagnostics.clear();
    commentManager.clearAll();
    statusBar.setIdle();
  });

  // ── Optional: auto-trigger on git stage ────────────────────────────────────
  setupIndexWatcher(context, analyzeCmd);

  context.subscriptions.push(analyzeCmd, clearCmd);
}

export function deactivate(): void {
  disposeOutputChannel();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showSummaryPanel(summary: string, context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    'commitDefenderSummary',
    'Commit Defender — AI Review',
    vscode.ViewColumn.Beside,
    { enableScripts: false }
  );
  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; line-height: 1.6; }
    h1   { font-size: 1.2em; color: var(--vscode-textLink-foreground); }
    pre  { background: var(--vscode-textBlockQuote-background); padding: 12px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>🛡 Commit Defender — AI Review Summary</h1>
  <div>${markdownToHtml(summary)}</div>
</body>
</html>`;
}

/** Minimal Markdown → HTML conversion (no external dependency). */
function markdownToHtml(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function setupIndexWatcher(
  context: vscode.ExtensionContext,
  analyzeCmd: vscode.Disposable
): void {
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
    debounce = setTimeout(
      () => vscode.commands.executeCommand('commitDefender.analyze'),
      2000
    );
  };

  watcher.onDidChange(trigger);
  watcher.onDidCreate(trigger);
  context.subscriptions.push(watcher);
}
