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
exports.SKIP_DIRS = void 0;
exports.isBinary = isBinary;
exports.filterForAnalysis = filterForAnalysis;
exports.collectFiles = collectFiles;
exports.getRepoRoot = getRepoRoot;
exports.getStagedFiles = getStagedFiles;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const excludeFilter_js_1 = require("./excludeFilter.js");
/**
 * Binary file extensions that cannot be meaningfully reviewed.
 * Every other file — any text format — is accepted for analysis.
 */
const BINARY_EXTENSIONS = new Set([
    // Images
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.tiff', '.tif', '.heic', '.heif', '.avif',
    // Video / audio
    '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv',
    '.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a',
    // Archives / packages
    '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
    '.jar', '.war', '.ear', '.vsix', '.whl', '.egg',
    // Compiled / native binaries
    '.pyc', '.pyo', '.pyd', '.class',
    '.so', '.dll', '.dylib', '.exe', '.bin', '.o', '.a', '.wasm',
    // Fonts
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    // Office / documents
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    // Database / data blobs
    '.db', '.sqlite', '.sqlite3',
    '.parquet', '.arrow', '.avro', '.pkl', '.pickle', '.npy', '.npz',
    // Lock files (auto-generated, not useful to review)
    '.lock',
]);
/**
 * Directories that are always skipped during filesystem walks.
 */
exports.SKIP_DIRS = new Set([
    '.git', 'node_modules', '__pycache__',
    '.venv', 'venv', 'env',
    'dist', 'build', 'out', 'target',
    '.next', '.nuxt', '.svelte-kit',
    'coverage', '.pytest_cache', '.mypy_cache', '.ruff_cache',
    'vendor', '.tox',
]);
/**
 * Returns true when a file is binary and should be excluded from analysis.
 * Files with no extension (Dockerfile, Makefile, .bashrc, etc.) are accepted.
 */
function isBinary(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext) {
        return false;
    } // no-extension files are text
    return BINARY_EXTENSIONS.has(ext);
}
/**
 * Filter a list of repo-relative paths to only those worth analyzing.
 * Rejects known binary extensions; accepts everything else.
 */
function filterForAnalysis(files) {
    return files.filter(f => !isBinary(f));
}
/**
 * Recursively collect all analyzable files under `dirPath`,
 * returning repo-relative paths. Skips noise directories, binary files,
 * and any paths matched by `excludePatterns` (gitignore-style).
 */
function collectFiles(dirPath, repoRoot, excludePatterns = []) {
    const results = [];
    function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                // Skip hidden dirs except a small allow-list
                if (entry.name.startsWith('.') &&
                    entry.name !== '.github' &&
                    entry.name !== '.commit-defender') {
                    continue;
                }
                if (exports.SKIP_DIRS.has(entry.name)) {
                    continue;
                }
                walk(path.join(dir, entry.name));
            }
            else if (entry.isFile()) {
                const fullPath = path.join(dir, entry.name);
                const rel = path.relative(repoRoot, fullPath);
                if (!rel.startsWith('..') && !isBinary(rel)) {
                    results.push(rel);
                }
            }
        }
    }
    walk(dirPath);
    return (0, excludeFilter_js_1.applyExcludes)(results, excludePatterns);
}
/** Returns the canonical repo root for the given directory. */
function getRepoRoot(cwd) {
    return execGit(['rev-parse', '--show-toplevel'], cwd);
}
/**
 * Returns repo-relative paths of currently staged (ACMR) files, filtered to
 * non-binary types and to anything matched by the user's excludePatterns.
 */
async function getStagedFiles(repoRoot, excludePatterns = []) {
    const output = await execGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], repoRoot);
    const all = output.split('\n').filter(Boolean);
    return (0, excludeFilter_js_1.applyExcludes)(filterForAnalysis(all), excludePatterns);
}
function execGit(args, cwd) {
    return new Promise((resolve, reject) => {
        const proc = (0, child_process_1.spawn)('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => (stdout += d.toString()));
        proc.stderr.on('data', (d) => (stderr += d.toString()));
        proc.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            }
            else {
                reject(new Error(`git ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`));
            }
        });
        proc.on('error', reject);
    });
}
//# sourceMappingURL=gitHelper.js.map