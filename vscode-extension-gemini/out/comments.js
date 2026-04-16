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
class CommentManager {
    threads = [];
    clearAll() {
        this.threads.forEach((t) => t.dispose());
        this.threads = [];
    }
    apply(report, repoRoot, ctrl) {
        this.clearAll();
        const { file_comments } = report.review;
        if (file_comments.length > 0) {
            for (const fc of file_comments) {
                this.createThread(ctrl, repoRoot, fc);
            }
        }
        else if (report.staged_files.length > 0) {
            // Fallback: show AI summary as a file-level thread on the first staged file
            this.createThread(ctrl, repoRoot, {
                file: report.staged_files[0],
                line: 0,
                comment: `**AI Review Summary**\n\n${report.review.summary}`,
                category: '',
            });
        }
    }
    createThread(ctrl, repoRoot, fc) {
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
        const comment = {
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
exports.CommentManager = CommentManager;
//# sourceMappingURL=comments.js.map