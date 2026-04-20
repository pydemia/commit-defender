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
exports.SuggestionCodeLensProvider = void 0;
const vscode = __importStar(require("vscode"));
const findingsStore_js_1 = require("./findingsStore.js");
const commentFormatter_js_1 = require("./commentFormatter.js");
class SuggestionCodeLensProvider {
    _onDidChangeCodeLenses = new vscode.EventEmitter();
    onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    constructor() {
        findingsStore_js_1.findingsStore.onDidChange.event(() => this._onDidChangeCodeLenses.fire());
    }
    provideCodeLenses(document) {
        const set = findingsStore_js_1.findingsStore.get(document.uri);
        if (!set) {
            return [];
        }
        const lenses = [];
        for (const [line0, blocks] of set.byLine) {
            if (line0 < 0) {
                continue;
            }
            const worst = blocks.reduce((w, b) => {
                if (!w) {
                    return b;
                }
                return (commentFormatter_js_1.PRIORITY_RANK[b.priority] ?? 0) > (commentFormatter_js_1.PRIORITY_RANK[w.priority] ?? 0) ? b : w;
            }, undefined);
            if (!worst) {
                continue;
            }
            const meta = (0, commentFormatter_js_1.metaForBlock)(worst);
            const count = blocks.length;
            const first = blocks[0].comment.split('\n')[0];
            lenses.push(new vscode.CodeLens(new vscode.Range(line0, 0, line0, 0), {
                title: `${meta.emoji} ${count} finding${count > 1 ? 's' : ''}`,
                tooltip: first,
                command: 'commitDefender.showLineSuggestion',
                arguments: [document.uri, line0],
            }));
        }
        return lenses;
    }
}
exports.SuggestionCodeLensProvider = SuggestionCodeLensProvider;
//# sourceMappingURL=codeLens.js.map