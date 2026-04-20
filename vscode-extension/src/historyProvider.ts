import * as vscode from 'vscode';
import { AnalysisReport } from './types.js';

export interface HistoryEntry {
  id: string;
  timestamp: Date;
  report: AnalysisReport;
  repoRoot: string;
  label: string;   // e.g. "3 files · proficient"
}

type TreeNode =
  | { kind: 'section'; label: string; children: TreeNode[] }
  | { kind: 'command'; label: string; description: string; command: string; icon: string }
  | { kind: 'entry'; entry: HistoryEntry }
  | { kind: 'empty'; label: string };

export class HistoryProvider implements vscode.TreeDataProvider<TreeNode> {
  private _history: HistoryEntry[] = [];
  private _emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._emitter.event;

  push(report: AnalysisReport, repoRoot: string): void {
    const grade = report.review.grade || 'ungraded';
    const count = report.staged_files.length;
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      timestamp: new Date(),
      report,
      repoRoot,
      label: `${count} file${count !== 1 ? 's' : ''} · ${grade}`,
    };
    this._history.unshift(entry);   // newest first
    if (this._history.length > 20) { this._history.pop(); }
    this._emitter.fire(undefined);
  }

  clear(): void {
    this._history = [];
    this._emitter.fire(undefined);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === 'section') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('folder');
      return item;
    }
    if (node.kind === 'command') {
      const item = new vscode.TreeItem(node.label);
      item.description = node.description;
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.command = { command: node.command, title: node.label };
      item.tooltip = node.description;
      return item;
    }
    if (node.kind === 'entry') {
      const e = node.entry;
      const item = new vscode.TreeItem(e.label, vscode.TreeItemCollapsibleState.None);
      item.description = formatTime(e.timestamp);
      item.iconPath = new vscode.ThemeIcon(gradeIcon(e.report.review.grade));
      item.tooltip = `${e.timestamp.toLocaleString()}\n${e.report.review.summary.slice(0, 200)}`;
      item.contextValue = 'historyEntry';
      item.command = {
        command: 'commitDefender.showHistoryEntry',
        title: 'Show Summary',
        arguments: [e],
      };
      return item;
    }
    // empty
    const item = new vscode.TreeItem(node.label);
    item.iconPath = new vscode.ThemeIcon('info');
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      // Root: Commands section + History section
      const commands: TreeNode[] = [
        { kind: 'command', label: 'Analyze Current File',   description: 'Review the open file', command: 'commitDefender.analyzeCurrentFile', icon: 'file-code' },
        { kind: 'command', label: 'Analyze Directory…',     description: 'Pick a folder to review', command: 'commitDefender.analyzeDirectory', icon: 'folder' },
        { kind: 'command', label: 'Analyze Staged Files',   description: 'Review git staged changes', command: 'commitDefender.analyze', icon: 'git-commit' },
        { kind: 'command', label: 'Analyze Repository',     description: 'Full repo scan', command: 'commitDefender.analyzeRepository', icon: 'repo' },
        { kind: 'command', label: 'Show Summary Panel',     description: 'Reopen last summary', command: 'commitDefender.showSummary', icon: 'preview' },
        { kind: 'command', label: 'Clear Findings',         description: 'Remove all comments & diagnostics', command: 'commitDefender.clearFindings', icon: 'clear-all' },
      ];

      const historyChildren: TreeNode[] = this._history.length > 0
        ? this._history.map(e => ({ kind: 'entry' as const, entry: e }))
        : [{ kind: 'empty', label: 'No analyses yet' }];

      return [
        { kind: 'section', label: 'Commands', children: commands },
        { kind: 'section', label: 'History', children: historyChildren },
      ];
    }
    if (node.kind === 'section') { return node.children; }
    return [];
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
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60)  { return 'just now'; }
  if (diff < 3600) { return `${Math.floor(diff / 60)}m ago`; }
  if (diff < 86400) { return `${Math.floor(diff / 3600)}h ago`; }
  return d.toLocaleDateString();
}
