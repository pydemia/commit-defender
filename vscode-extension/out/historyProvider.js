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
const types_js_1 = require("./types.js");
// ── Provider ───────────────────────────────────────────────────────────────────
class HistoryProvider {
    _history = [];
    _blocks = [];
    _lastReport;
    _isRunning = false;
    _cfg;
    _emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this._emitter.event;
    constructor(cfg) {
        this._cfg = cfg;
    }
    // ── State updaters ────────────────────────────────────────────────────────
    push(report, repoRoot) {
        const grade = report.review.grade || 'ungraded';
        const count = report.staged_files.length;
        const entry = {
            id: Date.now().toString(),
            timestamp: new Date(),
            report, repoRoot,
            label: `${count} file${count !== 1 ? 's' : ''} · ${grade}`,
        };
        this._history.unshift(entry);
        if (this._history.length > 20) {
            this._history.pop();
        }
        this._lastReport = report;
        this._emitter.fire(undefined);
    }
    updateFindings(blocks) {
        this._blocks = blocks;
        this._emitter.fire(undefined);
    }
    setRunning(running) {
        this._isRunning = running;
        this._emitter.fire(undefined);
    }
    updateConfig(cfg) {
        this._cfg = cfg;
        this._emitter.fire(undefined);
    }
    clear() {
        this._history = [];
        this._blocks = [];
        this._lastReport = undefined;
        this._emitter.fire(undefined);
    }
    // ── TreeDataProvider ──────────────────────────────────────────────────────
    getTreeItem(node) {
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
                const meta = types_js_1.PRIORITY_META[node.priority];
                const label = `${meta.emoji} ${node.priority} ${meta.label}`;
                const item = new vscode.TreeItem(`${label}  ×${node.count}`);
                item.description = `${node.count} finding${node.count !== 1 ? 's' : ''}`;
                item.iconPath = new vscode.ThemeIcon(node.priority === 'P3' ? 'error'
                    : node.priority === 'P2' ? 'warning'
                        : node.priority === 'P1' ? 'info'
                            : 'pass');
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
                item.id = node.id;
                return item;
            }
            default: {
                const item = new vscode.TreeItem(node.label);
                item.iconPath = new vscode.ThemeIcon(node.icon ?? 'info');
                item.id = node.id;
                return item;
            }
        }
    }
    getChildren(node) {
        if (!node) {
            return this._buildRoot();
        }
        if (node.kind === 'section') {
            return node.children;
        }
        return [];
    }
    // ── Root builder ──────────────────────────────────────────────────────────
    _buildRoot() {
        return [
            this._buildCommands(),
            this._buildFindings(),
            this._buildSettings(),
            this._buildHistory(),
        ];
    }
    // ── Commands section ──────────────────────────────────────────────────────
    _buildCommands() {
        const children = [
            { kind: 'command', id: 'cmd-commit-msg', label: 'Generate Commit Message', desc: 'Draft a message from staged diff', icon: 'wand', command: 'commitDefender.generateCommitMessage' },
            { kind: 'command', id: 'cmd-analyze', label: 'Analyze Staged Files', desc: 'Review git staged changes', icon: 'checklist', command: 'commitDefender.analyze' },
            { kind: 'command', id: 'cmd-analyze-file', label: 'Analyze Current File', desc: 'Review the open file', icon: 'file-code', command: 'commitDefender.analyzeCurrentFile' },
            { kind: 'command', id: 'cmd-analyze-dir', label: 'Analyze Directory…', desc: 'Pick a folder to review', icon: 'folder', command: 'commitDefender.analyzeDirectory' },
            { kind: 'command', id: 'cmd-analyze-repo', label: 'Analyze Repository', desc: 'Full repo scan', icon: 'repo', command: 'commitDefender.analyzeRepository' },
        ];
        if (this._isRunning) {
            children.push({ kind: 'command', id: 'cmd-cancel', label: 'Cancel Analysis', desc: 'Stop the running analysis', icon: 'stop-circle', command: 'commitDefender.cancel' });
        }
        children.push({ kind: 'command', id: 'cmd-summary', label: 'Show Summary Panel', desc: 'Reopen last summary', icon: 'preview', command: 'commitDefender.showSummary' }, { kind: 'command', id: 'cmd-clear', label: 'Clear Findings', desc: 'Remove all comments & diagnostics', icon: 'clear-all', command: 'commitDefender.clearFindings' });
        return { kind: 'section', id: 'sec-commands', label: 'Commands', icon: 'terminal', children };
    }
    // ── Current Findings section ──────────────────────────────────────────────
    _buildFindings() {
        const children = [];
        if (this._isRunning) {
            children.push({ kind: 'empty', id: 'findings-running', label: 'Analyzing…', icon: 'loading~spin' });
        }
        else if (this._blocks.length === 0) {
            children.push({ kind: 'empty', id: 'findings-empty', label: 'No findings', icon: 'check' });
        }
        else {
            // Count by priority
            const counts = {};
            for (const b of this._blocks) {
                counts[b.priority] = (counts[b.priority] ?? 0) + 1;
            }
            const passed = this._lastReport?.exit_code === 0;
            const verdict = {
                kind: 'status',
                id: 'findings-verdict',
                label: passed ? 'PASS' : 'BLOCKED',
                value: `${this._blocks.length} finding${this._blocks.length !== 1 ? 's' : ''}`,
                icon: passed ? 'pass' : 'error',
                command: 'commitDefender.showSummary',
                tooltip: passed ? 'All findings are advisory — commit is allowed' : 'P3 Critical finding blocks the commit',
            };
            children.push(verdict);
            for (const p of ['P3', 'P2', 'P1', 'P0']) {
                const n = counts[p];
                if (n) {
                    children.push({ kind: 'finding', id: `findings-${p}`, priority: p, count: n });
                }
            }
        }
        return { kind: 'section', id: 'sec-findings', label: 'Current Findings', icon: 'shield', children };
    }
    // ── Settings & Hooks section ──────────────────────────────────────────────
    _buildSettings() {
        const cfg = this._cfg;
        const openSettings = 'workbench.action.openSettings';
        const settingsQuery = '@ext:pydemia.commit-defender';
        const hookEnabled = cfg.preCommitHook === 'enable';
        const children = [
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
                kind: 'status', id: 'cfg-mode',
                label: 'Mode', value: cfg.analysisMode || 'hybrid',
                icon: 'settings-gear', command: openSettings, tooltip: `Analysis mode: ${cfg.analysisMode}\nClick to open settings`,
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
                ? { kind: 'command', id: 'cfg-hook-uninstall', label: 'Uninstall Pre-commit Hook', desc: 'Remove .git/hooks/pre-commit', icon: 'trash', command: 'commitDefender.uninstallPreCommitHook' }
                : { kind: 'command', id: 'cfg-hook-install', label: 'Install Pre-commit Hook', desc: 'Block commits on P3 findings', icon: 'terminal', command: 'commitDefender.installPreCommitHook' },
            {
                kind: 'command', id: 'cfg-open-settings',
                label: 'Open Settings', desc: 'All extension settings',
                icon: 'gear', command: openSettings, args: [settingsQuery],
            },
        ];
        return { kind: 'section', id: 'sec-settings', label: 'Settings & Hooks', icon: 'settings-gear', collapsed: true, children };
    }
    // ── History section ───────────────────────────────────────────────────────
    _buildHistory() {
        const children = this._history.length > 0
            ? this._history.map(e => ({ kind: 'entry', id: `entry-${e.id}`, entry: e }))
            : [{ kind: 'empty', id: 'history-empty', label: 'No analyses yet' }];
        return { kind: 'section', id: 'sec-history', label: 'History', icon: 'history', children, collapsed: false };
    }
}
exports.HistoryProvider = HistoryProvider;
// ── Helpers ────────────────────────────────────────────────────────────────────
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