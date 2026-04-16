/**
 * CodeLensProvider — renders "💡 N suggestion(s)" lenses above every line
 * that carries an AI file_comment or a lint finding.
 *
 * Clicking the lens executes `commitDefender.showLineSuggestion` which opens
 * a side panel with the full Markdown suggestion.
 */

import * as vscode from 'vscode';
import { findingsStore } from './findingsStore.js';

export class SuggestionCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor() {
    // Re-render lenses whenever the store refreshes
    findingsStore.onDidChange.event(() => this._onDidChangeCodeLenses.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const set = findingsStore.get(document.uri);
    if (!set) { return []; }

    const lenses: vscode.CodeLens[] = [];

    // One lens per line that has AI comments
    for (const [line0, comments] of set.commentByLine) {
      if (line0 < 0) { continue; } // skip file-level (shown by CommentManager)
      const range = new vscode.Range(line0, 0, line0, 0);
      const count = comments.length;
      lenses.push(new vscode.CodeLens(range, {
        title: `💡 ${count} AI suggestion${count > 1 ? 's' : ''}`,
        tooltip: comments[0].comment.split('\n')[0],
        command: 'commitDefender.showLineSuggestion',
        arguments: [document.uri, line0],
      }));
    }

    // Separate lint lens per line (only when no AI comment already shown there)
    for (const [line0, findings] of set.lintByLine) {
      if (set.commentByLine.has(line0)) { continue; } // already covered above
      const range = new vscode.Range(line0, 0, line0, 0);
      const errorCount = findings.filter(f => f.severity === 'error').length;
      const warnCount  = findings.filter(f => f.severity === 'warning').length;
      const parts: string[] = [];
      if (errorCount > 0) { parts.push(`${errorCount} error${errorCount > 1 ? 's' : ''}`); }
      if (warnCount  > 0) { parts.push(`${warnCount} warning${warnCount > 1 ? 's' : ''}`); }
      lenses.push(new vscode.CodeLens(range, {
        title: `⚠ ${parts.join(', ')}`,
        tooltip: findings[0].message,
        command: 'commitDefender.showLineSuggestion',
        arguments: [document.uri, line0],
      }));
    }

    return lenses;
  }
}
