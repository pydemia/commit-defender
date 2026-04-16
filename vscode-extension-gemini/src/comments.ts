import * as path from 'path';
import * as vscode from 'vscode';
import { AnalysisReport, FileComment } from './types.js';

export class CommentManager {
  private threads: vscode.CommentThread[] = [];

  clearAll(): void {
    this.threads.forEach((t) => t.dispose());
    this.threads = [];
  }

  apply(
    report: AnalysisReport,
    repoRoot: string,
    ctrl: vscode.CommentController
  ): void {
    this.clearAll();

    const { file_comments } = report.review;

    if (file_comments.length > 0) {
      for (const fc of file_comments) {
        this.createThread(ctrl, repoRoot, fc);
      }
    } else if (report.staged_files.length > 0) {
      // Fallback: show AI summary as a file-level thread on the first staged file
      this.createThread(ctrl, repoRoot, {
        file: report.staged_files[0],
        line: 0,
        comment: `**AI Review Summary**\n\n${report.review.summary}`,
        category: '',
      });
    }
  }

  private createThread(
    ctrl: vscode.CommentController,
    repoRoot: string,
    fc: FileComment
  ): void {
    const uri = vscode.Uri.file(path.join(repoRoot, fc.file));
    // 0-based; line 0 (file-level) stays at 0
    const line = Math.max(0, fc.line - 1);
    const range = new vscode.Range(line, 0, line, 0);

    // Build prefix: icon + optional category badge
    const icon = fc.line === 0 ? '📄' : '💡';
    const categoryBadge = fc.category ? ` \`${fc.category}\`` : '';
    const prefix = `**${icon} Suggestion${categoryBadge}**\n\n`;

    const body = new vscode.MarkdownString(prefix + fc.comment);
    body.isTrusted = true;
    body.supportHtml = false;

    const comment: vscode.Comment = {
      author: { name: 'Commit Defender AI' },
      body,
      mode: vscode.CommentMode.Preview,
    };

    const thread = ctrl.createCommentThread(uri, range, [comment]);
    // Show category in the thread label when available
    thread.label = fc.category ? `AI Comments · ${fc.category}` : 'AI Comments';
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.canReply = false;
    this.threads.push(thread);
  }
}
