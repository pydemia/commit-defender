/**
 * FindingsStore — in-memory registry of the latest analysis results.
 *
 * Both the CodeLensProvider and HoverProvider query this store so they
 * always reflect the most recent `commitDefender.analyze` run.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { AnalysisReport, FileComment, LintFinding } from './types.js';

export interface FileFindingSet {
  /** Lint findings for this file (0-based line index) */
  lintByLine: Map<number, LintFinding[]>;
  /** AI per-line comments (0-based line index; -1 = file-level) */
  commentByLine: Map<number, FileComment[]>;
}

class FindingsStore {
  private _data = new Map<string, FileFindingSet>();
  private _last: { report: AnalysisReport; repoRoot: string } | undefined;

  /** Fires whenever the store is updated or cleared. */
  readonly onDidChange = new vscode.EventEmitter<void>();

  /** Populate the store from a completed AnalysisReport. */
  update(report: AnalysisReport, repoRoot: string): void {
    this._last = { report, repoRoot };
    this._data.clear();

    // Index lint findings by absolute URI key + 0-based line
    for (const finding of report.lint_findings) {
      const absPath = path.join(repoRoot, finding.file);
      const uriKey = vscode.Uri.file(absPath).toString();
      const set = this._getOrCreate(uriKey);
      const line0 = Math.max(0, finding.line - 1);
      const bucket = set.lintByLine.get(line0) ?? [];
      bucket.push(finding);
      set.lintByLine.set(line0, bucket);
    }

    // Index AI file_comments by absolute URI key + 0-based line
    for (const fc of report.review.file_comments) {
      const absPath = path.join(repoRoot, fc.file);
      const uriKey = vscode.Uri.file(absPath).toString();
      const set = this._getOrCreate(uriKey);
      // line 0 in schema = file-level; store as -1 so it doesn't attach to line 0
      const line0 = fc.line === 0 ? -1 : fc.line - 1;
      const bucket = set.commentByLine.get(line0) ?? [];
      bucket.push(fc);
      set.commentByLine.set(line0, bucket);
    }

    this.onDidChange.fire();
  }

  /** Return findings for a given document URI (string form). */
  get(uri: vscode.Uri): FileFindingSet | undefined {
    return this._data.get(uri.toString());
  }

  /** Return the most recent report + repoRoot, or undefined if none yet. */
  lastReport(): { report: AnalysisReport; repoRoot: string } | undefined {
    return this._last;
  }

  clear(): void {
    this._data.clear();
    this.onDidChange.fire();
  }

  private _getOrCreate(uriKey: string): FileFindingSet {
    let set = this._data.get(uriKey);
    if (!set) {
      set = { lintByLine: new Map(), commentByLine: new Map() };
      this._data.set(uriKey, set);
    }
    return set;
  }
}

/** Singleton shared across the extension lifetime. */
export const findingsStore = new FindingsStore();
