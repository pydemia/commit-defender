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
exports.applyDiagnostics = applyDiagnostics;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const commentFormatter_js_1 = require("./commentFormatter.js");
const PRIORITY_SEVERITY = {
    P3: vscode.DiagnosticSeverity.Error,
    P2: vscode.DiagnosticSeverity.Warning,
    P1: vscode.DiagnosticSeverity.Information,
    P0: vscode.DiagnosticSeverity.Hint,
};
function applyDiagnostics(blocks, repoRoot, collection) {
    collection.clear();
    const byFile = new Map();
    for (const b of blocks) {
        if (b.line <= 0) {
            continue;
        }
        const list = byFile.get(b.file) ?? [];
        list.push(b);
        byFile.set(b.file, list);
    }
    for (const [relFile, fileBlocks] of byFile) {
        const uri = vscode.Uri.file(path.join(repoRoot, relFile));
        const diagnostics = fileBlocks.map(b => {
            const line = Math.max(0, b.line - 1);
            const col = Math.max(0, (b.col ?? 1) - 1);
            const range = new vscode.Range(line, col, line, Number.MAX_SAFE_INTEGER);
            // Message format: "[P3·Security] rule — first line of comment"
            //                 "[P1·Maintenance] first line of comment"
            const cat = b.category ? (0, commentFormatter_js_1.formatCategory)(b.category) : '';
            const catPart = cat ? `·${cat}` : '';
            const prefix = `[${b.priority}${catPart}]`;
            const body = b.comment.split('\n')[0].trim();
            const message = b.source === 'lint' && b.rule
                ? `${prefix} ${b.rule} — ${body}`
                : `${prefix} ${body}`;
            const diag = new vscode.Diagnostic(range, message, PRIORITY_SEVERITY[b.priority]);
            diag.source = `commit-defender · ${b.source}`;
            if (b.source === 'lint' && b.rule) {
                diag.code = b.rule;
            }
            return diag;
        });
        collection.set(uri, diagnostics);
    }
}
//# sourceMappingURL=diagnostics.js.map