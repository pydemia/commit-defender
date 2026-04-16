/**
 * HoverProvider — shows the AI suggestion and lint details for a line
 * when the user hovers over it in the editor.
 */

import * as vscode from 'vscode';
import { findingsStore } from './findingsStore.js';

export class SuggestionHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const set = findingsStore.get(document.uri);
    if (!set) { return; }

    const line0 = position.line;
    const aiComments = set.commentByLine.get(line0);
    const lintFindings = set.lintByLine.get(line0);

    if (!aiComments?.length && !lintFindings?.length) { return; }

    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportHtml = true;

    // ── AI suggestions ────────────────────────────────────────────────────────
    if (aiComments?.length) {
      md.appendMarkdown('### 💡 Commit Defender — AI Suggestion\n\n');
      for (const fc of aiComments) {
        md.appendMarkdown(fc.comment + '\n\n');
        md.appendMarkdown('---\n\n');
      }
    }

    // ── Lint findings ─────────────────────────────────────────────────────────
    if (lintFindings?.length) {
      if (aiComments?.length) {
        md.appendMarkdown('\n');
      }
      md.appendMarkdown('### ⚠ Lint Findings\n\n');
      for (const f of lintFindings) {
        const icon = f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : '🔵';
        md.appendMarkdown(
          `${icon} **[${f.rule}]** ${f.message}  \n`
        );
      }
    }

    // Cover the full line
    const range = document.lineAt(line0).range;
    return new vscode.Hover(md, range);
  }
}
