"use strict";
/**
 * Git diff and file content extraction. Pure-TS replacement for the Python
 * DiffExtractor.
 */
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
exports.MAX_CONTENT_CHARS = void 0;
exports.git = git;
exports.getStagedDiff = getStagedDiff;
exports.getFileContents = getFileContents;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Cap diff/file content size to keep token usage bounded (~25K tokens). */
exports.MAX_CONTENT_CHARS = 80_000;
/** Empty-tree SHA used as the diff base on the very first commit. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
/** Promise wrapper around `git -C <repoRoot> <args...>`. */
function git(repoRoot, args) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)('git', ['-C', repoRoot, ...args], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
            if (err) {
                const e = new Error(`git ${args.join(' ')} failed: ${stderr.trim() || err.message}`);
                e.code = err.code;
                return reject(e);
            }
            resolve(stdout);
        });
    });
}
/**
 * Combined unified diff for the listed staged files. Falls back to diffing
 * against the empty tree when there is no HEAD yet (initial commit).
 */
async function getStagedDiff(repoRoot, relPaths) {
    if (relPaths.length === 0) {
        return '';
    }
    let out;
    try {
        out = await git(repoRoot, ['diff', '--cached', '--diff-filter=d', '--', ...relPaths]);
    }
    catch {
        out = await git(repoRoot, ['diff', '--cached', '--diff-filter=d', EMPTY_TREE, '--', ...relPaths]);
    }
    return truncate(out);
}
/**
 * Read full file contents wrapped in fenced code blocks, one section per file.
 * Used by on-demand (file/directory/repository) analysis where the AI gets the
 * whole file rather than the staged hunk.
 */
function getFileContents(repoRoot, relPaths) {
    if (relPaths.length === 0) {
        return '';
    }
    const parts = [];
    for (const rel of relPaths) {
        const abs = path.join(repoRoot, rel);
        let content;
        try {
            content = fs.readFileSync(abs, 'utf8');
        }
        catch {
            continue;
        }
        const ext = path.extname(rel).replace(/^\./, '');
        parts.push(`### ${rel}\n\n\`\`\`${ext}\n${content}\n\`\`\``);
    }
    return truncate(parts.join('\n\n'));
}
function truncate(s) {
    if (s.length <= exports.MAX_CONTENT_CHARS) {
        return s;
    }
    return s.slice(0, exports.MAX_CONTENT_CHARS) + '\n\n[... truncated for token limit ...]';
}
//# sourceMappingURL=diff.js.map