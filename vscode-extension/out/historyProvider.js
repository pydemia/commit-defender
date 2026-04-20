"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryProvider = void 0;
const vscode = __importStar(require("vscode"));
class HistoryProvider {
    _history = [];
    _emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this._emitter.event;
    push(report, repoRoot) {
        const grade = report.review.grade || 'ungraded';
        const count = report.staged_files.length;
        const entry = {
            id: Date.now().toString(),
            timestamp: new Date(),
            report,
            repoRoot,
            label: `${count} file${count !== 1 ? 's' : ''} · ${grade}`,
        };
        this._history.unshift(entry); // newest first
        if (this._history.length > 20) {
            this._history.pop();
        }
        this._emitter.fire(undefined);
    }
    clear() {
        this._history = [];
        this._emitter.fire(undefined);
    }
    getTreeItem(node) {
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
    getChildren(node) {
        if (!node) {
            // Root: Commands section + History section
            const commands = [
                { kind: 'command', label: 'Analyze Current File', description: 'Review the open file', command: 'commitDefender.analyzeCurrentFile', icon: 'file-code' },
                { kind: 'command', label: 'Analyze Directory…', description: 'Pick a folder to review', command: 'commitDefender.analyzeDirectory', icon: 'folder' },
                { kind: 'command', label: 'Analyze Staged Files', description: 'Review git staged changes', command: 'commitDefender.analyze', icon: 'git-commit' },
                { kind: 'command', label: 'Analyze Repository', description: 'Full repo scan', command: 'commitDefender.analyzeRepository', icon: 'repo' },
                { kind: 'command', label: 'Show Summary Panel', description: 'Reopen last summary', command: 'commitDefender.showSummary', icon: 'preview' },
                { kind: 'command', label: 'Clear Findings', description: 'Remove all comments & diagnostics', command: 'commitDefender.clearFindings', icon: 'clear-all' },
            ];
            const historyChildren = this._history.length > 0
                ? this._history.map(e => ({ kind: 'entry', entry: e }))
                : [{ kind: 'empty', label: 'No analyses yet' }];
            return [
                { kind: 'section', label: 'Commands', children: commands },
                { kind: 'section', label: 'History', children: historyChildren },
            ];
        }
        if (node.kind === 'section') {
            return node.children;
        }
        return [];
    }
}
exports.HistoryProvider = HistoryProvider;
function gradeIcon(grade) {
    switch (grade) {
        case 'exceptional': return 'pass';
        case 'proficient': return 'check';
        case 'adequate': return 'info';
        case 'insufficient': return 'warning';
        case 'critical': return 'error';
        default: return 'circle-outline';
    }
}
function formatTime(d) {
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60) {
        return 'just now';
    }
    if (diff < 3600) {
        return `${Math.floor(diff / 60)}m ago`;
    }
    if (diff < 86400) {
        return `${Math.floor(diff / 3600)}h ago`;
    }
    return d.toLocaleDateString();
}
//# sourceMappingURL=historyProvider.js.map