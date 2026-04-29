"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommentManager = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const commentFormatter_js_1 = require("./commentFormatter.js");
class CommentManager {
    threads = [];
    clearAll() {
        this.threads.forEach((t) => t.dispose());
        this.threads = [];
    }
    /** Create one thread per CommentBlock — one unit-comment-block per code segment. */
    apply(blocks, repoRoot, ctrl) {
        this.clearAll();
        for (const b of blocks) {
            if (b.line <= 0) {
                continue;
            }
            this._createThread(ctrl, repoRoot, b);
        }
    }
    /**
     * Render a unit-comment-block per spec:
     *   thread.label → "{emoji} {priority} {label} · {point-of-view}"
     *   author.name  → "Commit Defender" — keeps POV from duplicating in the
     *                  comment header VS Code renders above the body
     *   body         → just the AI-generated comment (no redundant header)
     */
    _createThread(ctrl, repoRoot, b) {
        const uri = vscode.Uri.file(path.join(repoRoot, b.file));
        const line = Math.max(0, b.line - 1);
        const range = new vscode.Range(line, 0, line, 0);
        const meta = (0, commentFormatter_js_1.metaForBlock)(b);
        const pov = b.category && b.priority !== 'P0' ? ` · ${(0, commentFormatter_js_1.formatCategory)(b.category)}` : '';
        const header = `${meta.emoji} ${b.priority} ${meta.label}${pov}`;
        const bodyText = b.source === 'lint' && b.rule
            ? `\`${b.rule}\` — ${b.comment}`
            : b.comment;
        const md = new vscode.MarkdownString(bodyText);
        md.isTrusted = true;
        md.supportHtml = false;
        const comment = {
            author: { name: 'Commit Defender' },
            body: md,
            mode: vscode.CommentMode.Preview,
        };
        const thread = ctrl.createCommentThread(uri, range, [comment]);
        thread.label = header;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        thread.canReply = false;
        this.threads.push(thread);
    }
}
exports.CommentManager = CommentManager;
//# sourceMappingURL=comments.js.map