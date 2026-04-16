import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export type AnalysisMode  = 'hybrid' | 'ai-powered' | 'rule-based';
export type SeverityLevel = 'severe' | 'rigorous' | 'moderate' | 'generous' | 'lean';
export type RichnessLevel = 'colorful' | 'chatty' | 'moderate' | 'simple' | 'silent';
export type Locale        = 'en' | 'ko';
export type AIProvider    = 'azure-openai' | 'anthropic' | 'openai';

export interface ExtensionConfig {
  pythonExecutable: string;
  timeoutSeconds: number;
  runOnStage: boolean;
  homeEnvFile: string;
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
  const homeEnvFile =
    cfg.get<string>('homeEnvFile') ||
    path.join(os.homedir(), '.commit-defender.env');

  let pythonExecutable = cfg.get<string>('pythonExecutable') ?? '${workspaceFolder}/.venv/bin/python';
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (ws && pythonExecutable.includes('${workspaceFolder}')) {
    pythonExecutable = pythonExecutable.replace('${workspaceFolder}', ws);
  }

  return {
    pythonExecutable,
    timeoutSeconds: cfg.get<number>('timeoutSeconds') ?? 120,
    runOnStage: cfg.get<boolean>('runOnStage') ?? true,
    homeEnvFile,
    analysisMode: (cfg.get<string>('analysisMode') ?? '') as AnalysisMode,
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
