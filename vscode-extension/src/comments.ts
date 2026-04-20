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

    // One vscode.Comment per block; author carries the p-level label
    const comments: vscode.Comment[] = lineBlocks.map(b => {
      const meta    = metaForBlock(b);
      const cat     = formatCategory(b.category);
      const bodyText = b.source === 'lint' && b.rule
        ? `\`${b.rule}\` ${b.comment}`
        : b.comment;
      const md = new vscode.MarkdownString(`**${cat}**\n\n${bodyText}`);
      md.isTrusted   = true;
      md.supportHtml = false;
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
