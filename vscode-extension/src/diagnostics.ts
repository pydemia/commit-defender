import * as path from 'path';
import * as vscode from 'vscode';
import { CommentBlock, CommentPriority } from './types.js';
import { formatCategory } from './commentFormatter.js';

const PRIORITY_SEVERITY: Record<CommentPriority, vscode.DiagnosticSeverity> = {
  P3: vscode.DiagnosticSeverity.Error,
  P2: vscode.DiagnosticSeverity.Warning,
  P1: vscode.DiagnosticSeverity.Information,
  P0: vscode.DiagnosticSeverity.Hint,
};

export function applyDiagnostics(
  blocks: CommentBlock[],
  repoRoot: string,
  collection: vscode.DiagnosticCollection
): void {
  collection.clear();

  const byFile = new Map<string, CommentBlock[]>();
  for (const b of blocks) {
    if (b.line <= 0) { continue; }
    const list = byFile.get(b.file) ?? [];
    list.push(b);
    byFile.set(b.file, list);
  }

  for (const [relFile, fileBlocks] of byFile) {
    const uri = vscode.Uri.file(path.join(repoRoot, relFile));
    const diagnostics = fileBlocks.map(b => {
      const line = Math.max(0, b.line - 1);
      const col  = Math.max(0, (b.col ?? 1) - 1);
      const range = new vscode.Range(line, col, line, Number.MAX_SAFE_INTEGER);

      const message = b.source === 'lint' && b.rule
        ? `[${b.rule}] ${b.comment}`
        : `[${formatCategory(b.category)}] ${b.comment.split('\n')[0]}`;

      const diag = new vscode.Diagnostic(range, message, PRIORITY_SEVERITY[b.priority]);
      diag.source = `commit-defender · ${b.source}`;
      if (b.source === 'lint' && b.rule) { diag.code = b.rule; }
      return diag;
    });
    collection.set(uri, diagnostics);
  }
}
