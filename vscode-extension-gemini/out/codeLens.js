"use strict";
/**
 * CodeLensProvider — renders "💡 N suggestion(s)" lenses above every line
 * that carries an AI file_comment or a lint finding.
 *
 * Clicking the lens executes `commitDefender.showLineSuggestion` which opens
 * a side panel with the full Markdown suggestion.
 */
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
exports.SuggestionCodeLensProvider = void 0;
const vscode = __importStar(require("vscode"));
const findingsStore_js_1 = require("./findingsStore.js");
class SuggestionCodeLensProvider {
    _onDidChangeCodeLenses = new vscode.EventEmitter();
    onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    constructor() {
        // Re-render lenses whenever the store refreshes
        findingsStore_js_1.findingsStore.onDidChange.event(() => this._onDidChangeCodeLenses.fire());
    }
    provideCodeLenses(document) {
        const set = findingsStore_js_1.findingsStore.get(document.uri);
        if (!set) {
            return [];
        }
        const lenses = [];
        // One lens per line that has AI comments
        for (const [line0, comments] of set.commentByLine) {
            if (line0 < 0) {
                continue;
            } // skip file-level (shown by CommentManager)
            const range = new vscode.Range(line0, 0, line0, 0);
            const count = comments.length;
            lenses.push(new vscode.CodeLens(range, {
                title: `💡 ${count} AI suggestion${count > 1 ? 's' : ''}`,
                tooltip: comments[0].comment.split('\n')[0],
                command: 'commitDefender.showLineSuggestion',
                arguments: [document.uri, line0],
            }));
        }
        // Separate lint lens per line (only when no AI comment already shown there)
        for (const [line0, findings] of set.lintByLine) {
            if (set.commentByLine.has(line0)) {
                continue;
            } // already covered above
            const range = new vscode.Range(line0, 0, line0, 0);
            const errorCount = findings.filter(f => f.severity === 'error').length;
            const warnCount = findings.filter(f => f.severity === 'warning').length;
            const parts = [];
            if (errorCount > 0) {
                parts.push(`${errorCount} error${errorCount > 1 ? 's' : ''}`);
            }
            if (warnCount > 0) {
                parts.push(`${warnCount} warning${warnCount > 1 ? 's' : ''}`);
            }
            lenses.push(new vscode.CodeLens(range, {
                title: `⚠ ${parts.join(', ')}`,
                tooltip: findings[0].message,
                command: 'commitDefender.showLineSuggestion',
                arguments: [document.uri, line0],
            }));
        }
        return lenses;
    }
}
exports.SuggestionCodeLensProvider = SuggestionCodeLensProvider;
//# sourceMappingURL=codeLens.js.map