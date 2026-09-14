import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { PaletteId } from './palette.js';
import type { StandaloneReviewSettings } from './standaloneReviewProtocol.js';
import type { ModelCredentialReference } from './modelCredentials.js';

export type SeverityLevel   = 'severe' | 'rigorous' | 'moderate' | 'generous' | 'lean';
export type RichnessLevel   = 'colorful' | 'chatty' | 'moderate' | 'simple' | 'silent';
export type Locale          = 'en' | 'ko';
export type AIProvider      = 'aoai' | 'anthropic' | 'openai' | 'gemini' | 'codex' | 'claudecode' | 'geminicli' | 'antigravity';
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
  /** User-level reference only; apiKey is populated later by the runtime credential resolver. */
  modelCredentialRef?: ModelCredentialReference;
  codexPath: string;
  claudeCodePath: string;
  geminiCliPath: string;
  antigravityPath: string;
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

/** Account selection and source grants are never read from a repository's settings.json. */
export function getStandaloneReviewSettings(fileCount: number, repoRoot?: string): StandaloneReviewSettings {
  const cfg = vscode.workspace.getConfiguration('commitDefender', repoRoot ? vscode.Uri.file(repoRoot) : undefined);
  const user = <T>(name: string): T | undefined => cfg.inspect<T>(name)?.globalValue;
  const seconds = user<number>(fileCount === 1 ? 'fileTimeoutSeconds' : 'directoryTimeoutSeconds');
  return {
    mode: user<string>('reviewMode') ?? 'standalone',
    profileId: user<string>('localProfile') ?? 'default',
    provider: user<string>('aiProvider') ?? 'unconfigured',
    model: user<string>('model') ?? '',
    reasoningEffort: user<string>('reviewReasoningEffort') ?? 'xhigh',
    executablePath: resolveCodexPath(user<string>('codexPath') ?? 'codex'),
    workspaceTrusted: vscode.workspace.isTrusted,
    durationMs: seconds && Number.isFinite(seconds) && seconds > 0
      ? Math.min(600_000, Math.floor(seconds * 1000)) : (fileCount === 1 ? 120_000 : 360_000),
    // Repository exclusions may only narrow the immutable source selection.
    excludePatterns: cfg.get<string[]>('excludePatterns') ?? [],
  };
}

export function getConfig(): ResolvedConfig {
  const cfg = vscode.workspace.getConfiguration('commitDefender');
  return {
    aiProvider:                (cfg.get<string>('aiProvider')    ?? 'aoai') as AIProvider,
    model:                     cfg.get<string>('model')          ?? '',
    endpoint:                  cfg.get<string>('endpoint')       ?? '',
    apiVersion:                cfg.get<string>('apiVersion')     ?? '2024-08-01-preview',
    apiKey:                    '',
    modelCredentialRef:        cfg.inspect<ModelCredentialReference>('modelCredentialRef')?.globalValue,
    codexPath:                 resolveCodexPath(cfg.get<string>('codexPath') ?? 'codex'),
    claudeCodePath:            resolveExternalCliPath(cfg.get<string>('claudeCodePath') ?? 'claude', 'claude'),
    geminiCliPath:             resolveExternalCliPath(cfg.get<string>('geminiCliPath') ?? 'gemini', 'gemini'),
    antigravityPath:           resolveExternalCliPath(cfg.get<string>('antigravityPath') ?? 'agy', 'agy'),
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
    runOnStage:                cfg.inspect<boolean>('runOnStage')?.globalValue ?? false,
  };
}

/**
 * The Codex VS Code extension ships a platform CLI, but its directory is not
 * guaranteed to be on another extension host's PATH. Reuse that official CLI
 * when the user has left Commit Defender's path at its default value.
 */
function resolveCodexPath(configured: string): string {
  if (configured.trim() !== 'codex') { return configured; }
  const discovered = resolveExternalCliPath(configured, 'codex');
  if (discovered !== configured) { return discovered; }
  const extensionPath = vscode.extensions.getExtension('openai.chatgpt')?.extensionPath;
  if (!extensionPath) { return configured; }
  const platform = process.platform;
  const arches = process.arch === 'arm64' ? ['aarch64', 'arm64'] : [process.arch];
  const names = process.platform === 'win32' ? ['codex.exe', 'codex'] : ['codex'];
  for (const arch of arches) {
    for (const name of names) {
      const candidate = path.join(extensionPath, 'bin', `${platform}-${arch}`, name);
      if (fs.existsSync(candidate)) { return candidate; }
    }
  }
  return configured;
}

/** Resolve optional npm/global CLI installs without bundling them into VSIX. */
function resolveExternalCliPath(configured: string, name: string): string {
  if (configured.trim() !== name) { return configured; }
  const executableNames = process.platform === 'win32'
    ? [`${name}.cmd`, `${name}.exe`, name]
    : [name];
  const candidates: string[] = [];

  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const executable of executableNames) { candidates.push(path.join(dir, executable)); }
  }

  const userHome = process.env.HOME || process.env.USERPROFILE;
  if (userHome) {
    for (const dir of ['.local/bin', 'bin', '.npm-global/bin']) {
      for (const executable of executableNames) { candidates.push(path.join(userHome, dir, executable)); }
    }
    const nvmVersions = path.join(userHome, '.nvm', 'versions', 'node');
    try {
      const versions = fs.readdirSync(nvmVersions).sort((a, b) =>
        b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
      for (const version of versions) {
        for (const executable of executableNames) {
          candidates.push(path.join(nvmVersions, version, 'bin', executable));
        }
      }
    } catch { /* NVM is optional. */ }
  }

  for (const dir of ['/usr/local/bin', '/opt/homebrew/bin']) {
    for (const executable of executableNames) { candidates.push(path.join(dir, executable)); }
  }
  return candidates.find(candidate => fs.existsSync(candidate)) ?? configured;
}

export function getAutomaticUserSettings(): (key: string) => unknown {
  const cfg = vscode.workspace.getConfiguration('commitDefender');
  return (key) => cfg.inspect(key)?.globalValue;
}
