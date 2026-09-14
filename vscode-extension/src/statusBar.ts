import * as vscode from 'vscode';
import type { AnalysisReport } from './types.js';
import { OUTCOME_META, reviewCoverage, reviewStatus } from './reviewOutcome.js';
import { resolveExitCode } from './exitResolver.js';

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

  setBackgroundInterrupted(count: number): void {
    this.setIdle(`${count} background review(s) interrupted. Click to check saved results without starting a new review.`);
    this.item.text = `$(history) CD: ${count} interrupted`;
    this.item.command = 'commitDefender.recoverBackgroundReview';
  }

  setPreparing(): void {
    this.setRunning();
    this.item.text = '$(loading~spin) Preparing local review... $(stop-circle)';
    this.item.tooltip = 'Capturing source and opening local context — click to cancel';
  }

  setProgress(current: number, total: number, file: string): void {
    this.item.text = `$(loading~spin) CD: ${current}/${total} — ${file.split('/').pop()} $(stop-circle)`;
    this.item.tooltip = `Analyzing file ${current} of ${total}: ${file} — click to cancel`;
    this.item.command = 'commitDefender.cancel';
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
  }

  setReport(report: AnalysisReport): void {
    const state = reviewStatus(report.review);
    const meta = OUTCOME_META[state];
    this.item.text = `$(${meta.icon}) CD: ${meta.label}`;
    this.item.tooltip = `${reviewCoverage(report)}. ${report.gcr ? 'Standalone review is advisory' : `Legacy hook: ${resolveExitCode(report) ? 'would block' : 'allows commit'}`}. Click to re-analyze.`;
    this.item.command = 'commitDefender.analyze';
    this.item.backgroundColor = undefined;
    this.item.color = new vscode.ThemeColor(meta.color);
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
