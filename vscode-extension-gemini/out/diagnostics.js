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
const SEVERITY_MAP = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    info: vscode.DiagnosticSeverity.Information,
};
function applyDiagnostics(report, repoRoot, collection) {
    collection.clear();
    // Group findings by file
    const byFile = new Map();
    for (const finding of report.lint_findings) {
        const list = byFile.get(finding.file) ?? [];
        list.push(finding);
        byFile.set(finding.file, list);
    }
    for (const [relFile, findings] of byFile) {
        const uri = vscode.Uri.file(path.join(repoRoot, relFile));
        const diagnostics = findings.map((f) => {
            // VS Code ranges are 0-based; JSON is 1-based
            const line = Math.max(0, f.line - 1);
            const col = Math.max(0, f.col - 1);
            const range = new vscode.Range(line, col, line, Number.MAX_SAFE_INTEGER);
            const diag = new vscode.Diagnostic(range, f.message, SEVERITY_MAP[f.severity] ?? vscode.DiagnosticSeverity.Warning);
            diag.source = 'commit-defender';
            diag.code = f.rule;
            return diag;
        });
        collection.set(uri, diagnostics);
    }
}
//# sourceMappingURL=diagnostics.js.map