import * as path from 'path';
import * as vscode from 'vscode';
import { AnalysisReport, LintFinding, Severity } from './types.js';

const SEVERITY_MAP: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export function applyDiagnostics(
  report: AnalysisReport,
  repoRoot: string,
  collection: vscode.DiagnosticCollection
): void {
  collection.clear();

  // Group findings by file
  const byFile = new Map<string, LintFinding[]>();
  for (const finding of report.lint_findings) {
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }

  for (const [relFile, findings] of byFile) {
    const uri = vscode.Uri.file(path.join(repoRoot, relFile));
    const diagnostics = findings.map((f) => {
      // VS Code ranges are 0-based; JSON is 1-based
      const line = Math.max(0, f.line - 1);
      const col = Math.max(0, f.col - 1);
      const range = new vscode.Range(line, col, line, Number.MAX_SAFE_INTEGER);
      const diag = new vscode.Diagnostic(
        range,
        f.message,
        SEVERITY_MAP[f.severity] ?? vscode.DiagnosticSeverity.Warning
      );
      diag.source = 'commit-defender';
      diag.code = f.rule;
      return diag;
    });
    collection.set(uri, diagnostics);
  }
}
