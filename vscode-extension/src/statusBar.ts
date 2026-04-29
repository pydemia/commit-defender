import * as vscode from 'vscode';

export class StatusBarManager {
  readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'commitDefender.analyze';
    this.setIdle();
    this.item.show();
  }

  setIdle(tooltip = 'Click to analyze staged files'): void {
    this.item.text = '$(shield) Commit Defender';
    this.item.tooltip = tooltip;
    this.item.command = 'commitDefender.analyze';
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
  }

  setRunning(): void {
    this.item.text = '$(loading~spin) Analyzing... $(stop-circle)';
    this.item.tooltip = 'Commit Defender is running — click to cancel';
    this.item.command = 'commitDefender.cancel';
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
  }

  setProgress(current: number, total: number, file: string): void {
    this.item.text = `$(loading~spin) CD: ${current}/${total} — ${file.split('/').pop()} $(stop-circle)`;
    this.item.tooltip = `Analyzing file ${current} of ${total}: ${file} — click to cancel`;
    this.item.command = 'commitDefender.cancel';
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
  }

  setResult(passed: boolean, grade?: string): void {
    const gradeLabel = grade ? ` · ${grade}` : '';
    this.item.command = 'commitDefender.analyze';
    if (passed) {
      this.item.text = `$(shield-check) CD: Pass${gradeLabel}`;
      this.item.tooltip = `Commit Defender: passed${grade ? ` (${grade})` : ''}. Click to re-analyze.`;
      this.item.backgroundColor = undefined;
      this.item.color = new vscode.ThemeColor('terminal.ansiGreen');
    } else {
      this.item.text = `$(shield-x) CD: Blocked${gradeLabel}`;
      this.item.tooltip = `Commit Defender: commit blocked${grade ? ` (${grade})` : ''}. Click to re-analyze.`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      this.item.color = undefined;
    }
  }

  setError(message: string): void {
    this.item.text = '$(warning) CD: Error';
    this.item.tooltip = `Commit Defender error: ${message}`;
    this.item.command = 'commitDefender.analyze';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.item.color = undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
