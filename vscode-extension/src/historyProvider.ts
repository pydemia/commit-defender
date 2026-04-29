import * as vscode from 'vscode';
import { AnalysisReport, CommentBlock, CommentPriority, PRIORITY_META } from './types.js';
import { ExtensionConfig } from './config.js';

// ── Public types ───────────────────────────────────────────────────────────────

export type AnalysisScope = 'staged' | 'file' | 'directory' | 'repository';

export interface HistoryEntry {
  id: string;
  timestamp: Date;
  report: AnalysisReport;
  repoRoot: string;
  label: string;
  scope: AnalysisScope;
  scopeTarget?: string;   // abs dir path for 'directory' scope
}

// ── Internal tree node types ───────────────────────────────────────────────────

type TreeNode =
  | { kind: 'section';     id: string; label: string; icon: string; children: TreeNode[]; collapsed?: boolean }
  | { kind: 'command';     id: string; label: string; desc: string; icon: string; command: string; args?: unknown[] }
  | { kind: 'finding';     id: string; priority: CommentPriority; count: number }
  | { kind: 'status';      id: string; label: string; value: string; icon: string; command?: string; tooltip?: string }
  | { kind: 'entry';       id: string; entry: HistoryEntry }
  | { kind: 'empty';       id: string; label: string; icon?: string };

// ── Provider ───────────────────────────────────────────────────────────────────

export class HistoryProvider implements vscode.TreeDataProvider<TreeNode> {
  private _history: HistoryEntry[] = [];
  private _blocks: CommentBlock[] = [];
  private _lastReport: AnalysisReport | undefined;
  private _isRunning = false;
  private _cfg: ExtensionConfig;
  private _emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(cfg: ExtensionConfig) {
    this._cfg = cfg;
  }

  // ── State updaters ────────────────────────────────────────────────────────

  push(report: AnalysisReport, repoRoot: string, scope: AnalysisScope, scopeTarget?: string): void {
    const grade = report.review.grade || 'ungraded';
    const count = report.staged_files.length;
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      timestamp: new Date(),
      report, repoRoot,
      label: `${count} file${count !== 1 ? 's' : ''} · ${grade}`,
      scope,
      scopeTarget,
    };
    this._history.unshift(entry);
    if (this._history.length > 20) { this._history.pop(); }
    this._lastReport = report;
    this._emitter.fire(undefined);
  }

  updateFindings(blocks: CommentBlock[]): void {
    this._blocks = blocks;
    this._emitter.fire(undefined);
  }

  setRunning(running: boolean): void {
    this._isRunning = running;
    this._emitter.fire(undefined);
  }

  updateConfig(cfg: ExtensionConfig): void {
    this._cfg = cfg;
    this._emitter.fire(undefined);
  }

  clear(): void {
    this._history = [];
    this._blocks = [];
    this._lastReport = undefined;
    this._emitter.fire(undefined);
  }

  // ── TreeDataProvider ──────────────────────────────────────────────────────

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'section': {
        const collapsed = node.collapsed
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded;
        const item = new vscode.TreeItem(node.label, collapsed);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.id = node.id;
        return item;
      }
      case 'command': {
        const item = new vscode.TreeItem(node.label);
        item.description = node.desc;
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.command = { command: node.command, title: node.label, arguments: node.args };
        item.tooltip = node.desc;
        item.id = node.id;
        return item;
      }
      case 'finding': {
        const meta  = PRIORITY_META[node.priority];
        const label = `${meta.emoji} ${node.priority} ${meta.label}`;
        const item  = new vscode.TreeItem(`${label}  ×${node.count}`);
        item.description = `${node.count} finding${node.count !== 1 ? 's' : ''}`;
        item.iconPath = new vscode.ThemeIcon(
          node.priority === 'P3' ? 'error'
          : node.priority === 'P2' ? 'warning'
          : node.priority === 'P1' ? 'info'
          : 'pass'
        );
        item.command = {
          command: node.priority === 'P3' || node.priority === 'P2'
            ? 'workbench.panel.markers.view.focus'
            : 'commitDefender.showSummary',
          title: 'Show findings',
        };
        item.tooltip = `${node.count} ${meta.label} finding${node.count !== 1 ? 's' : ''}`;
        item.id = node.id;
        return item;
      }
      case 'status': {
        const item = new vscode.TreeItem(node.label);
        item.description = node.value;
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.tooltip = node.tooltip ?? `${node.label}: ${node.value}`;
        if (node.command) {
          item.command = { command: node.command, title: node.label };
        }
        item.id = node.id;
        return item;
      }
      case 'entry': {
        const e    = node.entry;
        const item = new vscode.TreeItem(e.label, vscode.TreeItemCollapsibleState.None);
        item.description = `${scopeTag(e.scope)} · ${formatTime(e.timestamp)}`;
        item.iconPath    = new vscode.ThemeIcon(scopeIcon(e.scope));
        item.tooltip     = `${e.timestamp.toLocaleString()}\n[${scopeTag(e.scope)}] ${e.report.review.summary.slice(0, 200)}`;
        item.contextValue = 'historyEntry';
        item.command = {
          command: 'commitDefender.showHistoryEntry',
          title: 'Show Summary',
          arguments: [e],
        };
        item.id = node.id;
        return item;
      }
      default: {
        const item = new vscode.TreeItem((node as { label: string }).label);
        item.iconPath = new vscode.ThemeIcon((node as { icon?: string }).icon ?? 'info');
        item.id = (node as { id: string }).id;
        return item;
      }
    }
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) { return this._buildRoot(); }
    if (node.kind === 'section') { return node.children; }
    return [];
  }

  // ── Root builder ──────────────────────────────────────────────────────────

  private _buildRoot(): TreeNode[] {
    return [
      this._buildCommands(),
      this._buildFindings(),
      this._buildSettings(),
      this._buildHistory(),
    ];
  }

  // ── Commands section ──────────────────────────────────────────────────────

  private _buildCommands(): TreeNode {
    const children: TreeNode[] = [
      { kind: 'command', id: 'cmd-commit-msg',    label: 'Generate Commit Message',  desc: 'Draft a message from staged diff', icon: 'wand',      command: 'commitDefender.generateCommitMessage' },
      { kind: 'command', id: 'cmd-analyze',        label: 'Analyze Staged Files',     desc: 'Review git staged changes',        icon: 'checklist', command: 'commitDefender.analyze' },
      { kind: 'command', id: 'cmd-analyze-file',   label: 'Analyze Current File',     desc: 'Review the open file',             icon: 'file-code',  command: 'commitDefender.analyzeCurrentFile' },
      { kind: 'command', id: 'cmd-analyze-dir',    label: 'Analyze Directory…',       desc: 'Pick a folder to review',          icon: 'folder',     command: 'commitDefender.analyzeDirectory' },
      { kind: 'command', id: 'cmd-analyze-repo',   label: 'Analyze Repository',       desc: 'Full repo scan',                   icon: 'repo',       command: 'commitDefender.analyzeRepository' },
    ];

    if (this._isRunning) {
      children.push(
        { kind: 'command', id: 'cmd-cancel', label: 'Cancel Analysis', desc: 'Stop the running analysis', icon: 'stop-circle', command: 'commitDefender.cancel' },
      );
    }

    children.push(
      { kind: 'command', id: 'cmd-summary', label: 'Show Summary Panel', desc: 'Reopen last summary',                  icon: 'preview',   command: 'commitDefender.showSummary' },
      { kind: 'command', id: 'cmd-clear',   label: 'Clear Findings',     desc: 'Remove all comments & diagnostics',   icon: 'clear-all', command: 'commitDefender.clearFindings' },
    );

    return { kind: 'section', id: 'sec-commands', label: 'Commands', icon: 'terminal', children };
  }

  // ── Current Findings section ──────────────────────────────────────────────

  private _buildFindings(): TreeNode {
    const children: TreeNode[] = [];

    if (this._isRunning) {
      children.push({ kind: 'empty', id: 'findings-running', label: 'Analyzing…', icon: 'loading~spin' });
    } else if (this._blocks.length === 0) {
      children.push({ kind: 'empty', id: 'findings-empty', label: 'No findings', icon: 'check' });
    } else {
      // Count by priority
      const counts: Partial<Record<CommentPriority, number>> = {};
      for (const b of this._blocks) {
        counts[b.priority] = (counts[b.priority] ?? 0) + 1;
      }

      const passed = this._lastReport?.exit_code === 0;
      const verdict: TreeNode = {
        kind: 'status',
        id: 'findings-verdict',
        label: passed ? 'PASS' : 'BLOCKED',
        value: `${this._blocks.length} finding${this._blocks.length !== 1 ? 's' : ''}`,
        icon: passed ? 'pass' : 'error',
        command: 'commitDefender.showSummary',
        tooltip: passed ? 'All findings are advisory — commit is allowed' : 'P3 Critical finding blocks the commit',
      };
      children.push(verdict);

      for (const p of ['P3', 'P2', 'P1', 'P0'] as CommentPriority[]) {
        const n = counts[p];
        if (n) {
          children.push({ kind: 'finding', id: `findings-${p}`, priority: p, count: n });
        }
      }
    }

    return { kind: 'section', id: 'sec-findings', label: 'Current Findings', icon: 'shield', children };
  }

  // ── Settings & Hooks section ──────────────────────────────────────────────

  private _buildSettings(): TreeNode {
    const cfg = this._cfg;

    const openSettings = 'workbench.action.openSettings';
    const settingsQuery = '@ext:pydemia.commit-defender';

    const hookEnabled = cfg.preCommitHook === 'enable';

    const children: TreeNode[] = [
      {
        kind: 'status', id: 'cfg-provider',
        label: 'Provider', value: cfg.aiProvider || '(not set)',
        icon: 'cloud', command: openSettings, tooltip: `AI provider: ${cfg.aiProvider}\nClick to open settings`,
      },
      {
        kind: 'status', id: 'cfg-model',
        label: 'Model', value: cfg.model || '(not set)',
        icon: 'symbol-method', command: openSettings, tooltip: `Model: ${cfg.model || 'not configured'}\nClick to open settings`,
      },
      {
        kind: 'status', id: 'cfg-severity',
        label: 'Severity', value: cfg.severityLevel || 'moderate',
        icon: 'pulse', command: openSettings, tooltip: `Severity level: ${cfg.severityLevel}\nClick to open settings`,
      },
      {
        kind: 'status', id: 'cfg-run-on-stage',
        label: 'Run on Stage', value: cfg.runOnStage ? 'enabled' : 'disabled',
        icon: cfg.runOnStage ? 'eye' : 'eye-closed',
        command: openSettings,
        tooltip: `Auto-analyze on git add: ${cfg.runOnStage ? 'on' : 'off'}\nClick to open settings`,
      },
      {
        kind: 'status', id: 'cfg-hook',
        label: 'Pre-commit Hook', value: hookEnabled ? 'enabled' : 'disabled',
        icon: hookEnabled ? 'check' : 'circle-slash',
        tooltip: `Git pre-commit hook: ${hookEnabled ? 'installed' : 'not installed'}`,
      },
      hookEnabled
        ? { kind: 'command', id: 'cfg-hook-uninstall', label: 'Uninstall Pre-commit Hook', desc: 'Remove .git/hooks/pre-commit', icon: 'trash',    command: 'commitDefender.uninstallPreCommitHook' }
        : { kind: 'command', id: 'cfg-hook-install',   label: 'Install Pre-commit Hook',   desc: 'Block commits on P3 findings', icon: 'terminal', command: 'commitDefender.installPreCommitHook' },
      {
        kind: 'command', id: 'cfg-open-settings',
        label: 'Open Settings', desc: 'All extension settings',
        icon: 'gear', command: openSettings, args: [settingsQuery],
      },
    ];

    return { kind: 'section', id: 'sec-settings', label: 'Settings & Hooks', icon: 'settings-gear', collapsed: true, children };
  }

  // ── History section ───────────────────────────────────────────────────────

  private _buildHistory(): TreeNode {
    const children: TreeNode[] = this._history.length > 0
      ? this._history.map(e => ({ kind: 'entry' as const, id: `entry-${e.id}`, entry: e }))
      : [{ kind: 'empty', id: 'history-empty', label: 'No analyses yet' }];

    return { kind: 'section', id: 'sec-history', label: 'History', icon: 'history', children, collapsed: false };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function scopeIcon(scope: AnalysisScope): string {
  switch (scope) {
    case 'staged':     return 'git-commit';
    case 'file':       return 'file-code';
    case 'directory':  return 'folder';
    case 'repository': return 'repo';
  }
}

function scopeTag(scope: AnalysisScope): string {
  switch (scope) {
    case 'staged':     return 'staged';
    case 'file':       return 'file';
    case 'directory':  return 'dir';
    case 'repository': return 'repo';
  }
}

function gradeIcon(grade: string): string {
  switch (grade) {
    case 'exceptional':  return 'pass';
    case 'proficient':   return 'check';
    case 'adequate':     return 'info';
    case 'insufficient': return 'warning';
    case 'critical':     return 'error';
    default:             return 'circle-outline';
  }
}

function formatTime(d: Date): string {
  const now  = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60)     { return 'just now'; }
  if (diff < 3600)   { return `${Math.floor(diff / 60)}m ago`; }
  if (diff < 86400)  { return `${Math.floor(diff / 3600)}h ago`; }
  return d.toLocaleDateString();
}
