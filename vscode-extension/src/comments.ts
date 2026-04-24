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

  /** Create one thread per CommentBlock — one unit-comment-block per code segment. */
  apply(blocks: CommentBlock[], repoRoot: string, ctrl: vscode.CommentController): void {
    this.clearAll();
    for (const b of blocks) {
      if (b.line <= 0) { continue; }
      this._createThread(ctrl, repoRoot, b);
    }
  }

  /**
   * Render a unit-comment-block per spec:
   *   thread.label → "{emoji} {priority} {label} · {point-of-view}"
   *   body         → just the AI-generated comment (no redundant header)
   */
  private _createThread(
    ctrl: vscode.CommentController,
    repoRoot: string,
    b: CommentBlock,
  ): void {
    const uri   = vscode.Uri.file(path.join(repoRoot, b.file));
    const line  = Math.max(0, b.line - 1);
    const range = new vscode.Range(line, 0, line, 0);

    const meta   = metaForBlock(b);
    const pov    = b.category && b.priority !== 'P0' ? ` · ${formatCategory(b.category)}` : '';
    const header = `${meta.emoji} ${b.priority} ${meta.label}${pov}`;

    const bodyText = b.source === 'lint' && b.rule
      ? `\`${b.rule}\` — ${b.comment}`
      : b.comment;
    const md = new vscode.MarkdownString(bodyText);
    md.isTrusted   = true;
    md.supportHtml = false;

    const comment: vscode.Comment = {
      author: { name: 'Commit Defender AI' },
      body:   md,
      mode:   vscode.CommentMode.Preview,
    };

    const thread = ctrl.createCommentThread(uri, range, [comment]);
    thread.label            = header;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.canReply         = false;
    this.threads.push(thread);
  }
}
