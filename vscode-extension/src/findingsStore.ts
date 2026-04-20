/**
 * FindingsStore — in-memory registry of the latest analysis results.
 *
 * Stores CommentBlock[] (from normalizeReport) indexed by file URI + 0-based line.
 * CodeLensProvider and other consumers query this store.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { AnalysisReport, CommentBlock } from './types.js';
import { normalizeReport } from './commentFormatter.js';

export interface FileBlockSet {
  /** CommentBlocks for this file, keyed by 0-based line index */
  byLine: Map<number, CommentBlock[]>;
}

class FindingsStore {
  private _data = new Map<string, FileBlockSet>();
  private _last: { report: AnalysisReport; repoRoot: string; blocks: CommentBlock[] } | undefined;

  /** Fires whenever the store is updated or cleared. */
  readonly onDidChange = new vscode.EventEmitter<void>();

  /** Populate the store from a completed AnalysisReport. */
  update(report: AnalysisReport, repoRoot: string): void {
    const blocks = normalizeReport(report);
    this._last = { report, repoRoot, blocks };
    this._data.clear();

    for (const b of blocks) {
      if (b.line <= 0) { continue; }
      const absPath = path.join(repoRoot, b.file);
      const uriKey = vscode.Uri.file(absPath).toString();
      const set = this._getOrCreate(uriKey);
      const line0 = b.line - 1;
      const bucket = set.byLine.get(line0) ?? [];
      bucket.push(b);
      set.byLine.set(line0, bucket);
    }

    this.onDidChange.fire();
  }

  /** Return findings for a given document URI (string form). */
  get(uri: vscode.Uri): FileBlockSet | undefined {
    return this._data.get(uri.toString());
  }

  /** Return the most recent report + repoRoot + blocks, or undefined if none yet. */
  lastReport(): { report: AnalysisReport; repoRoot: string; blocks: CommentBlock[] } | undefined {
    return this._last;
  }

  clear(): void {
    this._data.clear();
    this._last = undefined;
    this.onDidChange.fire();
  }

  private _getOrCreate(uriKey: string): FileBlockSet {
    let set = this._data.get(uriKey);
    if (!set) {
      set = { byLine: new Map() };
      this._data.set(uriKey, set);
    }
    return set;
  }
}

/** Singleton shared across the extension lifetime. */
export const findingsStore = new FindingsStore();
