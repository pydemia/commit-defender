/**
 * HoverProvider — shows findings for a line when the user hovers.
 * NOTE: Not registered in subscriptions; CommentController is the primary inline display.
 */

import * as vscode from 'vscode';
import { findingsStore } from './findingsStore.js';
import { metaForBlock, formatCategory } from './commentFormatter.js';

export class SuggestionHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const set = findingsStore.get(document.uri);
    if (!set) { return; }

    const line0 = position.line;
    const blocks = set.byLine.get(line0);
    if (!blocks?.length) { return; }

    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;

    for (const b of blocks) {
      const meta = metaForBlock(b);
      const cat  = formatCategory(b.category);
      md.appendMarkdown(`${meta.emoji} **${b.priority} ${meta.label}** — ${cat}\n\n`);
      if (b.source === 'lint' && b.rule) {
        md.appendMarkdown(`\`${b.rule}\` ${b.comment}\n\n`);
      } else {
        md.appendMarkdown(`${b.comment}\n\n`);
      }
      md.appendMarkdown('---\n\n');
    }

    return new vscode.Hover(md, document.lineAt(line0).range);
  }
}
