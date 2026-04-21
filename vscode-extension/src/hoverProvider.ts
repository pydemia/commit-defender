/**
 * HoverProvider — shows a compact finding summary when the user hovers over a line.
 * CommentController threads are the primary inline display (always visible);
 * this provides the on-hover tooltip as a complement.
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
      const meta    = metaForBlock(b);
      const cat     = b.category ? formatCategory(b.category) : '';
      const catPart = cat && b.priority !== 'P0' ? ` — ${cat}` : '';
      md.appendMarkdown(`${meta.emoji} **${b.priority} ${meta.label}**${catPart}\n\n`);
      if (b.source === 'lint' && b.rule) {
        md.appendMarkdown(`\`${b.rule}\` — ${b.comment}\n\n`);
      } else {
        md.appendMarkdown(`${b.comment}\n\n`);
      }
      md.appendMarkdown('---\n\n');
    }

    return new vscode.Hover(md, document.lineAt(line0).range);
  }
}
