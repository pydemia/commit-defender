import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ExtensionConfig {
  image: string;
  timeoutSeconds: number;
  runOnStage: boolean;
  homeEnvFile: string;
}

export function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('commitDefender');
  const homeEnvFile =
    cfg.get<string>('homeEnvFile') ||
    path.join(os.homedir(), '.commit-defender.env');

  return {
    image: cfg.get<string>('image') ?? 'commit-defender:latest',
    timeoutSeconds: cfg.get<number>('timeoutSeconds') ?? 120,
    runOnStage: cfg.get<boolean>('runOnStage') ?? false,
    homeEnvFile,
  };
}
