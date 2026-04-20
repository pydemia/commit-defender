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
exports.getConfig = getConfig;
const vscode = __importStar(require("vscode"));
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('commitDefender');
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let pythonExecutable = cfg.get('pythonExecutable') ?? '';
    if (!pythonExecutable) {
        // Auto-detect: prefer the VS Code Python extension's active interpreter,
        // then fall back to 'python3'.
        const pyExtInterpreter = vscode.workspace.getConfiguration('python').get('defaultInterpreterPath') ?? '';
        pythonExecutable = pyExtInterpreter || 'python3';
    }
    // Resolve ${workspaceFolder} placeholder if the user typed it manually.
    if (ws && pythonExecutable.includes('${workspaceFolder}')) {
        pythonExecutable = pythonExecutable.replace(/\$\{workspaceFolder\}/g, ws);
    }
    return {
        pythonExecutable,
        preCommitHook: (cfg.get('preCommitHook') ?? 'enable'),
        fileTimeoutSeconds: cfg.get('fileTimeoutSeconds') ?? 120,
        directoryTimeoutSeconds: cfg.get('directoryTimeoutSeconds') ?? 360,
        stagedFilesWarnThreshold: cfg.get('stagedFilesWarnThreshold') ?? 20,
        repoAnalysisWarnThreshold: cfg.get('repoAnalysisWarnThreshold') ?? 80,
        runOnStage: cfg.get('runOnStage') ?? true,
        analysisMode: (cfg.get('analysisMode') ?? 'hybrid'),
        severityLevel: (cfg.get('severityLevel') ?? ''),
        richnessLevel: (cfg.get('richnessLevel') ?? ''),
        locale: (cfg.get('locale') ?? ''),
        excludePatterns: cfg.get('excludePatterns') ?? [],
        aiProvider: (cfg.get('aiProvider') ?? 'azure-openai'),
        model: cfg.get('model') ?? '',
        endpoint: cfg.get('endpoint') ?? '',
        apiVersion: cfg.get('apiVersion') ?? '2024-08-01-preview',
        apiKey: cfg.get('apiKey') ?? '',
        maxTokens: cfg.get('maxTokens') ?? 4096,
    };
}
//# sourceMappingURL=config.js.map