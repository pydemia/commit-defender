"use strict";
/**
 * Inline skip directives — drop AI findings on lines marked with:
 *   # CD:skip            — explicit suppression
 *   # CD:skip:<reason>   — same; reason is a human note
 *   # type: ignore       — type-checker suppression
 *   # TODO               — known unfinished work
 *
 * Markers are language-agnostic: we match on `#`-style comments because that's
 * what the original Python implementation supported, and the markers are meant
 * to be developer signals rather than syntax-aware.
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
exports.applyMarkers = applyMarkers;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const PATTERNS = [
    /#\s*CD\s*:\s*skip/i,
    /#\s*type\s*:\s*ignore/,
    /#\s*TODO\b/i,
];
function isMarked(line) {
    return PATTERNS.some(re => re.test(line));
}
function scanFile(absPath) {
    const marked = new Set();
    let text;
    try {
        text = fs.readFileSync(absPath, 'utf8');
    }
    catch {
        return marked;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (isMarked(lines[i])) {
            marked.add(i + 1);
        }
    }
    return marked;
}
/** Drop file comments that land on a marker line. Returns a new array. */
function applyMarkers(comments, staged, repoRoot) {
    const skipMap = new Map();
    for (const rel of staged) {
        const lines = scanFile(path.join(repoRoot, rel));
        if (lines.size > 0) {
            skipMap.set(rel, lines);
        }
    }
    if (skipMap.size === 0) {
        return comments;
    }
    return comments.filter(c => !skipMap.get(c.file)?.has(c.line));
}
//# sourceMappingURL=skipMarkers.js.map