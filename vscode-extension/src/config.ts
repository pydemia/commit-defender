import * as vscode from 'vscode';

export type AnalysisMode    = 'hybrid' | 'ai-powered' | 'rule-based';
export type SeverityLevel   = 'severe' | 'rigorous' | 'moderate' | 'generous' | 'lean';
export type RichnessLevel   = 'colorful' | 'chatty' | 'moderate' | 'simple' | 'silent';
export type Locale          = 'en' | 'ko';
export type AIProvider      = 'azure-openai' | 'anthropic' | 'openai' | 'gemini';
export type PreCommitHook   = 'enable' | 'disable';

export interface ExtensionConfig {
  pythonExecutable: string;
  preCommitHook: PreCommitHook;
  fileTimeoutSeconds: number;
  directoryTimeoutSeconds: number;
  stagedFilesWarnThreshold: number;
  repoAnalysisWarnThreshold: number;
  runOnStage: boolean;
  analysisMode: AnalysisMode;
  severityLevel: SeverityLevel;
  richnessLevel: RichnessLevel;
  locale: Locale;
  excludePatterns: string[];
  // AI connection settings
  aiProvider: AIProvider;
  model: string;
  endpoint: string;
  apiVersion: string;
  apiKey: string;
  maxTokens: number;
}

export function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('commitDefender');
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let pythonExecutable = cfg.get<string>('pythonExecutable') ?? '';

  if (!pythonExecutable) {
    // Auto-detect: prefer the VS Code Python extension's active interpreter,
    // then fall back to 'python3'.
    const pyExtInterpreter =
      vscode.workspace.getConfiguration('python').get<string>('defaultInterpreterPath') ?? '';
    pythonExecutable = pyExtInterpreter || 'python3';
  }

  // Resolve ${workspaceFolder} placeholder if the user typed it manually.
  if (ws && pythonExecutable.includes('${workspaceFolder}')) {
    pythonExecutable = pythonExecutable.replace(/\$\{workspaceFolder\}/g, ws);
  }

  return {
    pythonExecutable,
    preCommitHook: (cfg.get<string>('preCommitHook') ?? 'enable') as PreCommitHook,
    fileTimeoutSeconds:        cfg.get<number>('fileTimeoutSeconds')        ?? 120,
    directoryTimeoutSeconds:   cfg.get<number>('directoryTimeoutSeconds')   ?? 360,
    stagedFilesWarnThreshold:  cfg.get<number>('stagedFilesWarnThreshold')  ?? 20,
    repoAnalysisWarnThreshold: cfg.get<number>('repoAnalysisWarnThreshold') ?? 80,
    runOnStage: cfg.get<boolean>('runOnStage') ?? true,
    analysisMode: (cfg.get<string>('analysisMode') ?? 'hybrid') as AnalysisMode,
    severityLevel: (cfg.get<string>('severityLevel') ?? '') as SeverityLevel,
    richnessLevel: (cfg.get<string>('richnessLevel') ?? '') as RichnessLevel,
    locale: (cfg.get<string>('locale') ?? '') as Locale,
    excludePatterns: cfg.get<string[]>('excludePatterns') ?? [],
    aiProvider:  (cfg.get<string>('aiProvider') ?? 'azure-openai') as AIProvider,
    model:       cfg.get<string>('model')      ?? '',
    endpoint:    cfg.get<string>('endpoint')   ?? '',
    apiVersion:  cfg.get<string>('apiVersion') ?? '2024-08-01-preview',
    apiKey:      cfg.get<string>('apiKey')     ?? '',
    maxTokens:   cfg.get<number>('maxTokens')  ?? 4096,
  };
}
