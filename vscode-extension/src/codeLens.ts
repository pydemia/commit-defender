import * as vscode from 'vscode';
import { findingsStore } from './findingsStore.js';
import { metaForBlock, PRIORITY_RANK } from './commentFormatter.js';
import { CommentBlock } from './types.js';
import * as path from 'path';
import { liveSource } from './reviewSource.js';

export class SuggestionCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor() {
    findingsStore.onDidChange.event(() => this._onDidChangeCodeLenses.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const set = findingsStore.get(document.uri);
    const last = findingsStore.lastReport();
    if (!set || !last || document.uri.scheme !== 'file') { return []; }
    const file = path.relative(last.repoRoot, document.uri.fsPath).split(path.sep).join('/');
    if (liveSource(last.repoRoot, last.report, file, document.getText()) === undefined) return [];

    const lenses: vscode.CodeLens[] = [];

    for (const [line0, blocks] of set.byLine) {
      if (line0 < 0 || line0 >= document.lineCount) { continue; }

      const worst = blocks.reduce<CommentBlock | undefined>((w, b) => {
        if (!w) { return b; }
        return (PRIORITY_RANK[b.priority] ?? 0) > (PRIORITY_RANK[w.priority] ?? 0) ? b : w;
      }, undefined);
      if (!worst) { continue; }

      const meta = metaForBlock(worst);
      const count = blocks.length;
      const first = blocks[0].comment.split('\n')[0];

      lenses.push(new vscode.CodeLens(new vscode.Range(line0, 0, line0, 0), {
        title: `${meta.emoji} ${count} finding${count > 1 ? 's' : ''}`,
        tooltip: first,
        command: 'commitDefender.showLineSuggestion',
        arguments: [document.uri, line0],
      }));
    }

    return lenses;
  }
}
