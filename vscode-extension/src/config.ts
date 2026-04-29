import * as vscode from 'vscode';
import { PaletteId } from './palette.js';

export type SeverityLevel   = 'severe' | 'rigorous' | 'moderate' | 'generous' | 'lean';
export type RichnessLevel   = 'colorful' | 'chatty' | 'moderate' | 'simple' | 'silent';
export type Locale          = 'en' | 'ko';
export type AIProvider      = 'aoai' | 'anthropic' | 'openai' | 'gemini';
export type PreCommitHook   = 'enable' | 'disable';

/**
 * Snapshot of the user's commitDefender.* settings. The Reviewer and the hook
 * CLI both consume this shape — extension reads it from VS Code, hook reads
 * it from the materialised .commit-defender/hook.json.
 */
export interface ResolvedConfig {
  // AI connection
  aiProvider: AIProvider;
  model: string;
  endpoint: string;
  apiVersion: string;
  apiKey: string;
  maxTokens: number;
  // Review behavior
  severityLevel: SeverityLevel;
  richnessLevel: RichnessLevel;
  locale: Locale;
  excludePatterns: string[];
  // UX (extension only — hook ignores these)
  colorPalette: PaletteId;
  preCommitHook: PreCommitHook;
  fileTimeoutSeconds: number;
  directoryTimeoutSeconds: number;
  stagedFilesWarnThreshold: number;
  repoAnalysisWarnThreshold: number;
  runOnStage: boolean;
}

/** Backwards-compatible alias kept for code that hasn't been renamed yet. */
export type ExtensionConfig = ResolvedConfig;

export function getConfig(): ResolvedConfig {
  const cfg = vscode.workspace.getConfiguration('commitDefender');
  return {
    aiProvider:                (cfg.get<string>('aiProvider')    ?? 'aoai') as AIProvider,
    model:                     cfg.get<string>('model')          ?? '',
    endpoint:                  cfg.get<string>('endpoint')       ?? '',
    apiVersion:                cfg.get<string>('apiVersion')     ?? '2024-08-01-preview',
    apiKey:                    cfg.get<string>('apiKey')         ?? '',
    maxTokens:                 cfg.get<number>('maxTokens')      ?? 4096,
    severityLevel:             (cfg.get<string>('severityLevel') ?? 'moderate') as SeverityLevel,
    richnessLevel:             (cfg.get<string>('richnessLevel') ?? 'moderate') as RichnessLevel,
    locale:                    (cfg.get<string>('locale')        ?? 'en') as Locale,
    excludePatterns:           cfg.get<string[]>('excludePatterns') ?? [],
    colorPalette:              (cfg.get<string>('colorPalette')  ?? 'theme-adaptive') as PaletteId,
    preCommitHook:             (cfg.get<string>('preCommitHook') ?? 'disable') as PreCommitHook,
    fileTimeoutSeconds:        cfg.get<number>('fileTimeoutSeconds')        ?? 120,
    directoryTimeoutSeconds:   cfg.get<number>('directoryTimeoutSeconds')   ?? 360,
    stagedFilesWarnThreshold:  cfg.get<number>('stagedFilesWarnThreshold')  ?? 20,
    repoAnalysisWarnThreshold: cfg.get<number>('repoAnalysisWarnThreshold') ?? 80,
    runOnStage:                cfg.get<boolean>('runOnStage') ?? true,
  };
}
