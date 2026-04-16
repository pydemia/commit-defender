"use strict";
/**
 * HoverProvider — shows the AI suggestion and lint details for a line
 * when the user hovers over it in the editor.
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
exports.SuggestionHoverProvider = void 0;
const vscode = __importStar(require("vscode"));
const findingsStore_js_1 = require("./findingsStore.js");
class SuggestionHoverProvider {
    provideHover(document, position) {
        const set = findingsStore_js_1.findingsStore.get(document.uri);
        if (!set) {
            return;
        }
        const line0 = position.line;
        const aiComments = set.commentByLine.get(line0);
        const lintFindings = set.lintByLine.get(line0);
        if (!aiComments?.length && !lintFindings?.length) {
            return;
        }
        const md = new vscode.MarkdownString('', true);
        md.isTrusted = true;
        md.supportHtml = true;
        // ── AI suggestions ────────────────────────────────────────────────────────
        if (aiComments?.length) {
            md.appendMarkdown('### 💡 Commit Defender — AI Suggestion\n\n');
            for (const fc of aiComments) {
                md.appendMarkdown(fc.comment + '\n\n');
                md.appendMarkdown('---\n\n');
            }
        }
        // ── Lint findings ─────────────────────────────────────────────────────────
        if (lintFindings?.length) {
            if (aiComments?.length) {
                md.appendMarkdown('\n');
            }
            md.appendMarkdown('### ⚠ Lint Findings\n\n');
            for (const f of lintFindings) {
                const icon = f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : '🔵';
                md.appendMarkdown(`${icon} **[${f.rule}]** ${f.message}  \n`);
            }
        }
        // Cover the full line
        const range = document.lineAt(line0).range;
        return new vscode.Hover(md, range);
    }
}
exports.SuggestionHoverProvider = SuggestionHoverProvider;
//# sourceMappingURL=hoverProvider.js.map