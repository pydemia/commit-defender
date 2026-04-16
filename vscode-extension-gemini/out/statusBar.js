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
exports.StatusBarManager = void 0;
const vscode = __importStar(require("vscode"));
class StatusBarManager {
    item;
    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'commitDefender.analyze';
        this.setIdle();
        this.item.show();
    }
    setIdle(tooltip = 'Click to analyze staged files') {
        this.item.text = '$(shield) Commit Defender';
        this.item.tooltip = tooltip;
        this.item.backgroundColor = undefined;
        this.item.color = undefined;
    }
    setRunning() {
        this.item.text = '$(loading~spin) Analyzing...';
        this.item.tooltip = 'Commit Defender is running...';
        this.item.backgroundColor = undefined;
        this.item.color = undefined;
    }
    setProgress(current, total, file) {
        this.item.text = `$(loading~spin) CD: ${current}/${total} — ${file.split('/').pop()}`;
        this.item.tooltip = `Analyzing file ${current} of ${total}: ${file}`;
        this.item.backgroundColor = undefined;
        this.item.color = undefined;
    }
    setResult(passed, grade) {
        const gradeLabel = grade ? ` · ${grade}` : '';
        if (passed) {
            this.item.text = `$(shield-check) CD: Pass${gradeLabel}`;
            this.item.tooltip = `Commit Defender: passed${grade ? ` (${grade})` : ''}. Click to re-analyze.`;
            this.item.backgroundColor = undefined;
            this.item.color = new vscode.ThemeColor('terminal.ansiGreen');
        }
        else {
            this.item.text = `$(shield-x) CD: Blocked${gradeLabel}`;
            this.item.tooltip = `Commit Defender: commit blocked${grade ? ` (${grade})` : ''}. Click to re-analyze.`;
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            this.item.color = undefined;
        }
    }
    setError(message) {
        this.item.text = '$(warning) CD: Error';
        this.item.tooltip = `Commit Defender error: ${message}`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.item.color = undefined;
    }
    dispose() {
        this.item.dispose();
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=statusBar.js.map