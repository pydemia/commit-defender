/**
 * PanelProvider — bottom-panel ("COMMIT DEFENDER") tree that mirrors the
 * built-in PROBLEMS view but only shows Commit Defender findings.
 *
 * Layout: file → finding rows. Each row carries a colored ThemeIcon plus a
 * priority/category badge painted via FileDecorationProvider, so the tree
 * reads at a glance like Problems but in Commit Defender's palette.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { CommentBlock, CommentPriority, PRIORITY_META } from './types.js';
import { formatCategory, PRIORITY_RANK } from './commentFormatter.js';

type PanelNode =
  | { kind: 'file';    id: string; file: string; absPath: string; blocks: CommentBlock[]; uri: vscode.Uri }
  | { kind: 'block';   id: string; block: CommentBlock; absPath: string; uri: vscode.Uri }
  | { kind: 'empty';   id: string; label: string };

const PRIORITY_ICON: Record<CommentPriority, string> = {
  P3: 'error',
  P2: 'warning',
  P1: 'info',
  P0: 'pass',
};

// Priority → ThemeColor for icons + decorations.
// Maps to VS Code's chart colors so it lights up across themes.
const PRIORITY_COLOR_ID: Record<CommentPriority, string> = {
  P3: 'list.errorForeground',
  P2: 'list.warningForeground',
  P1: 'charts.blue',
  P0: 'charts.green',
};

const PRIORITY_EMOJI: Record<CommentPriority, string> = {
  P3: '🟥',
  P2: '🟧',
  P1: '🟦',
  P0: '🟩',
};

const URI_SCHEME = 'commit-defender-finding';

export class PanelProvider implements vscode.TreeDataProvider<PanelNode> {
  private _blocks: CommentBlock[] = [];
  private _repoRoot: string = '';
  private _isRunning = false;
  private _emitter = new vscode.EventEmitter<PanelNode | undefined>();
  readonly onDidChangeTreeData = this._emitter.event;

  // Map decoration URIs → priority + optional badge so a single
  // FileDecorationProvider can paint every row.
  private _decorations = new Map<string, { priority: CommentPriority; badge: string; tooltip: string }>();
  private _decoEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();

  decorationProvider: vscode.FileDecorationProvider = {
    onDidChangeFileDecorations: this._decoEmitter.event,
    provideFileDecoration: (uri) => {
      if (uri.scheme !== URI_SCHEME) { return undefined; }
      const entry = this._decorations.get(uri.toString());
      if (!entry) { return undefined; }
      // No color here — VS Code would tint the whole row's text. Keep
      // labels plain; the colored ThemeIcon already conveys priority.
      return new vscode.FileDecoration(entry.badge, entry.tooltip);
    },
  };

  updateFindings(blocks: CommentBlock[], repoRoot: string): void {
    this._blocks = blocks;
    this._repoRoot = repoRoot;
    this._rebuildDecorations();
    this._emitter.fire(undefined);
  }

  setRunning(running: boolean): void {
    this._isRunning = running;
    this._emitter.fire(undefined);
  }

  clear(): void {
    const oldUris = Array.from(this._decorations.keys()).map(s => vscode.Uri.parse(s));
    this._blocks = [];
    this._repoRoot = '';
    this._decorations.clear();
    if (oldUris.length) { this._decoEmitter.fire(oldUris); }
    this._emitter.fire(undefined);
  }

  getTreeItem(node: PanelNode): vscode.TreeItem {
    switch (node.kind) {
      case 'file': {
        const item = new vscode.TreeItem(
          path.basename(node.file),
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.resourceUri = node.uri;
        const dir = path.dirname(node.file);
        item.description = `${dir === '.' ? '' : dir + '  '}· ${node.blocks.length} finding${node.blocks.length !== 1 ? 's' : ''}`;
        const worst = worstPriority(node.blocks);
        const counts = countByPriority(node.blocks);
        item.tooltip = `${node.file} — ${node.blocks.length} finding${node.blocks.length !== 1 ? 's' : ''}` +
          (worst ? ` (worst: ${worst})` : '') +
          summarizeCounts(counts);
        item.iconPath = worst
          ? new vscode.ThemeIcon(PRIORITY_ICON[worst], new vscode.ThemeColor(PRIORITY_COLOR_ID[worst]))
          : new vscode.ThemeIcon('file');
        item.id = node.id;
        return item;
      }
      case 'block': {
        const b = node.block;
        const meta = PRIORITY_META[b.priority];
        // "author" is the point-of-view tag — same label used in the
        // CommentController thread author (formatCategory(b.category)).
        const author = formatCategory(b.category);
        const emoji = PRIORITY_EMOJI[b.priority];
        const body = b.comment.split('\n')[0].trim();
        const ruleTag = b.source === 'lint' && b.rule ? `${b.rule} — ` : '';
        const label = `${emoji} @${author}: ${ruleTag}${body}`;

        const item = new vscode.TreeItem(label);
        item.resourceUri = node.uri;
        item.iconPath = new vscode.ThemeIcon(
          PRIORITY_ICON[b.priority],
          new vscode.ThemeColor(PRIORITY_COLOR_ID[b.priority]),
        );
        const lineRef = b.line > 0
          ? `Ln ${b.line}${b.col ? `, Col ${b.col}` : ''}`
          : 'file-level';
        item.description = lineRef;
        item.tooltip = new vscode.MarkdownString(
          `**${meta.emoji} ${b.priority} ${meta.label}** · _@${author}_\n\n${b.comment}`,
        );
        item.command = {
          command: 'vscode.open',
          title: 'Open',
          arguments: [
            vscode.Uri.file(node.absPath),
            {
              selection: new vscode.Range(
                Math.max(0, b.line - 1), Math.max(0, (b.col ?? 1) - 1),
                Math.max(0, b.line - 1), Math.max(0, (b.col ?? 1) - 1),
              ),
              preserveFocus: false,
              preview: true,
            } as vscode.TextDocumentShowOptions,
          ],
        };
        item.id = node.id;
        return item;
      }
      default: {
        const item = new vscode.TreeItem(node.label);
        item.iconPath = new vscode.ThemeIcon(
          this._isRunning ? 'loading~spin' : 'shield',
          new vscode.ThemeColor('charts.blue'),
        );
        item.id = node.id;
        return item;
      }
    }
  }

  getChildren(node?: PanelNode): PanelNode[] {
    if (!node) { return this._buildRoot(); }
    if (node.kind === 'file') {
      return node.blocks
        .slice()
        .sort((a, b) => {
          const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
          if (pr !== 0) { return pr; }
          return (a.line || 0) - (b.line || 0);
        })
        .map((b, idx) => {
          const id = `${node.id}::${idx}`;
          return {
            kind: 'block' as const,
            id,
            block: b,
            absPath: node.absPath,
            uri: this._blockUri(id),
          };
        });
    }
    return [];
  }

  private _buildRoot(): PanelNode[] {
    if (this._isRunning && this._blocks.length === 0) {
      return [{ kind: 'empty', id: 'panel-running', label: 'Analyzing…' }];
    }
    if (this._blocks.length === 0) {
      return [{ kind: 'empty', id: 'panel-empty', label: 'No Commit Defender findings.' }];
    }

    const byFile = new Map<string, CommentBlock[]>();
    for (const b of this._blocks) {
      const list = byFile.get(b.file) ?? [];
      list.push(b);
      byFile.set(b.file, list);
    }

    const files = Array.from(byFile.entries())
      .sort(([fa, ba], [fb, bb]) => {
        const wa = worstPriority(ba);
        const wb = worstPriority(bb);
        const ra = wa ? PRIORITY_RANK[wa] : -1;
        const rb = wb ? PRIORITY_RANK[wb] : -1;
        if (ra !== rb) { return rb - ra; }
        return fa.localeCompare(fb);
      });

    return files.map(([file, blocks], idx) => {
      const id = `panel-file-${idx}`;
      return {
        kind: 'file' as const,
        id,
        file,
        absPath: path.join(this._repoRoot, file),
        blocks,
        uri: this._fileUri(id, blocks),
      };
    });
  }

  // ── Decoration plumbing ───────────────────────────────────────────────────

  private _fileUri(id: string, blocks: CommentBlock[]): vscode.Uri {
    return vscode.Uri.from({ scheme: URI_SCHEME, path: `/file/${id}`, query: `n=${blocks.length}` });
  }

  private _blockUri(id: string): vscode.Uri {
    return vscode.Uri.from({ scheme: URI_SCHEME, path: `/block/${encodeURIComponent(id)}` });
  }

  private _rebuildDecorations(): void {
    const oldUris = Array.from(this._decorations.keys()).map(s => vscode.Uri.parse(s));
    this._decorations.clear();

    // File rows — badge with worst priority code (P3/P2/P1/P0).
    const byFile = new Map<string, CommentBlock[]>();
    for (const b of this._blocks) {
      const list = byFile.get(b.file) ?? [];
      list.push(b);
      byFile.set(b.file, list);
    }
    const sortedFiles = Array.from(byFile.entries()).sort(([fa, ba], [fb, bb]) => {
      const wa = worstPriority(ba);
      const wb = worstPriority(bb);
      const ra = wa ? PRIORITY_RANK[wa] : -1;
      const rb = wb ? PRIORITY_RANK[wb] : -1;
      if (ra !== rb) { return rb - ra; }
      return fa.localeCompare(fb);
    });
    sortedFiles.forEach(([, blocks], idx) => {
      const worst = worstPriority(blocks);
      if (!worst) { return; }
      const fileUri = this._fileUri(`panel-file-${idx}`, blocks);
      this._decorations.set(fileUri.toString(), {
        priority: worst,
        badge: worst.replace('P', ''),   // "3" / "2" / "1" / "0"
        tooltip: `Worst: ${worst} ${PRIORITY_META[worst].label}`,
      });
    });

    // Block rows — badge with priority code, colored by category if present.
    sortedFiles.forEach(([, blocks], fileIdx) => {
      const sorted = blocks.slice().sort((a, b) => {
        const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
        if (pr !== 0) { return pr; }
        return (a.line || 0) - (b.line || 0);
      });
      sorted.forEach((b, idx) => {
        const id = `panel-file-${fileIdx}::${idx}`;
        const uri = this._blockUri(id);
        const meta = PRIORITY_META[b.priority];
        this._decorations.set(uri.toString(), {
          priority: b.priority,
          badge: b.priority.replace('P', ''),
          tooltip: `${meta.label}${b.category ? ` · ${formatCategory(b.category)}` : ''}`,
        });
      });
    });

    const newUris = Array.from(this._decorations.keys()).map(s => vscode.Uri.parse(s));
    const fired = [...oldUris, ...newUris];
    if (fired.length) { this._decoEmitter.fire(fired); }
  }
}

function worstPriority(blocks: CommentBlock[]): CommentPriority | undefined {
  let worst: CommentPriority | undefined;
  for (const b of blocks) {
    if (!worst || PRIORITY_RANK[b.priority] > PRIORITY_RANK[worst]) {
      worst = b.priority;
    }
  }
  return worst;
}

function countByPriority(blocks: CommentBlock[]): Partial<Record<CommentPriority, number>> {
  const counts: Partial<Record<CommentPriority, number>> = {};
  for (const b of blocks) {
    counts[b.priority] = (counts[b.priority] ?? 0) + 1;
  }
  return counts;
}

function summarizeCounts(counts: Partial<Record<CommentPriority, number>>): string {
  const parts: string[] = [];
  for (const p of ['P3', 'P2', 'P1', 'P0'] as CommentPriority[]) {
    const n = counts[p];
    if (n) { parts.push(`${p}×${n}`); }
  }
  return parts.length ? `\n${parts.join(' ')}` : '';
}
