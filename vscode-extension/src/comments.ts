import * as path from 'path';
import * as vscode from 'vscode';
import { CommentBlock } from './types.js';
import { metaForBlock, formatCategory } from './commentFormatter.js';

export class CommentManager {
  private threads: vscode.CommentThread[] = [];

  clearAll(): void {
    this.threads.forEach((t) => t.dispose());
    this.threads = [];
  }

  /** Create one thread per line; each block on that line becomes a vscode.Comment inside it. */
  apply(blocks: CommentBlock[], repoRoot: string, ctrl: vscode.CommentController): void {
    this.clearAll();

    // Group by file + line — preserves the worst-first order from normalizeReport
    const byLine = new Map<string, CommentBlock[]>();
    for (const b of blocks) {
      if (b.line <= 0) { continue; }
      const key = `${b.file}\x00${b.line}`;
      const list = byLine.get(key) ?? [];
      list.push(b);
      byLine.set(key, list);
    }

    for (const lineBlocks of byLine.values()) {
      this._createThread(ctrl, repoRoot, lineBlocks);
    }
  }

  private _createThread(
    ctrl: vscode.CommentController,
    repoRoot: string,
    lineBlocks: CommentBlock[],   // sorted worst-priority first
  ): void {
    const first = lineBlocks[0];
    const uri   = vscode.Uri.file(path.join(repoRoot, first.file));
    const line  = Math.max(0, first.line - 1);
    const range = new vscode.Range(line, 0, line, 0);

    // One vscode.Comment per block; author = priority label, body = category + comment.
    const comments: vscode.Comment[] = lineBlocks.map(b => {
      const meta = metaForBlock(b);
      const cat  = b.category ? formatCategory(b.category) : '';

      // Build body: optional category header, then comment text.
      // Lint blocks prefix the rule code; AI blocks use the raw markdown comment.
      const md = new vscode.MarkdownString();
      md.isTrusted   = true;
      md.supportHtml = false;

      if (cat && b.priority !== 'P0') {
        md.appendMarkdown(`**${cat}**\n\n`);
      }
      if (b.source === 'lint' && b.rule) {
        md.appendMarkdown(`\`${b.rule}\` — ${b.comment}`);
      } else {
        md.appendMarkdown(b.comment);
      }

      return {
        author: { name: `${meta.emoji} ${b.priority} ${meta.label}` },
        body:   md,
        mode:   vscode.CommentMode.Preview,
      };
    });

    // Thread label = worst priority on this line (first block after sort)
    const worstMeta = metaForBlock(first);
    const thread = ctrl.createCommentThread(uri, range, comments);
    thread.label            = `${worstMeta.emoji} ${first.priority} ${worstMeta.label}`;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.canReply         = false;
    this.threads.push(thread);
  }
}
