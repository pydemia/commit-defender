import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export type RunnerMode = 'docker' | 'local';

export interface ExtensionConfig {
  runnerMode: RunnerMode;
  // Docker mode
  image: string;
  homeEnvFile: string;
  // Local mode
  pythonPath: string;
  // Shared
  timeoutSeconds: number;
  runOnStage: boolean;
}

export function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('commitDefender');
  const homeEnvFile =
    cfg.get<string>('homeEnvFile') ||
    path.join(os.homedir(), '.commit-defender.env');

  return {
    runnerMode: (cfg.get<string>('runnerMode') ?? 'docker') as RunnerMode,
    image: cfg.get<string>('image') ?? 'commit-defender:latest',
    homeEnvFile,
    pythonPath: cfg.get<string>('pythonPath') || 'python3',
    timeoutSeconds: cfg.get<number>('timeoutSeconds') ?? 120,
    runOnStage: cfg.get<boolean>('runOnStage') ?? false,
  };
}
