"use strict";
/**
 * Pre-commit hook entry point. Bundled by esbuild to a single
 * `out/hook-cli.js` file that doesn't depend on VS Code APIs.
 *
 * Reads <repo>/.commit-defender/hook.json (written by the extension on hook
 * install), runs the AI review against the staged diff, prints a colour
 * report to stderr, and exits 0 (pass) or 1 (block).
 *
 * Cannot import anything from vscode.* — esbuild is configured to mark vscode
 * as external; calling into it here would explode at runtime.
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
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const diff_js_1 = require("../diff.js");
const excludeFilter_js_1 = require("../excludeFilter.js");
const exitResolver_js_1 = require("../exitResolver.js");
const skipMarkers_js_1 = require("../skipMarkers.js");
const skills_js_1 = require("../skills.js");
const json_js_1 = require("../ai/json.js");
const prompt_js_1 = require("../ai/prompt.js");
const providers_js_1 = require("../ai/providers.js");
const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
async function main() {
    const repoRoot = process.argv[2] || process.cwd();
    const cfg = readConfig(repoRoot);
    if (!cfg) {
        eprintln('commit-defender: hook config not found — skipping review.');
        eprintln('  Re-install the hook from VS Code: command "Commit Defender: Install Pre-commit Hook".');
        process.exit(0);
    }
    const stagedAll = listStagedFiles(repoRoot);
    if (stagedAll.length === 0) {
        process.exit(0);
    }
    const staged = (0, excludeFilter_js_1.applyExcludes)(stagedAll.filter(p => !isBinary(p)), cfg.excludePatterns);
    if (staged.length === 0) {
        process.exit(0);
    }
    const diff = await (0, diff_js_1.getStagedDiff)(repoRoot, staged);
    if (!diff.trim()) {
        process.exit(0);
    }
    eprintln(`\n🛡  commit-defender — reviewing ${staged.length} staged file(s)…`);
    const skillsText = (0, skills_js_1.loadSkills)(repoRoot);
    const systemPrompt = (0, prompt_js_1.buildSystemPrompt)({
        mode: 'diff',
        severity: cfg.severityLevel,
        richness: cfg.richnessLevel,
        locale: cfg.locale,
        skillsText,
    });
    const userMessage = (0, prompt_js_1.buildUserMessage)('diff', diff);
    const resp = await (0, providers_js_1.callProvider)({
        provider: cfg.aiProvider,
        apiKey: cfg.apiKey,
        endpoint: cfg.endpoint,
        apiVersion: cfg.apiVersion,
        model: cfg.model,
        maxTokens: cfg.maxTokens,
        systemPrompt,
        userMessage,
        timeoutMs: 120_000,
    });
    if (resp.error) {
        eprintln(`\n⚠ AI review unavailable — commit not blocked.\n  ${indent(resp.error, '  ')}`);
        process.exit(0);
    }
    let parsed;
    try {
        parsed = (0, json_js_1.parseReviewJson)(resp.raw);
    }
    catch (e) {
        eprintln(`\n⚠ Could not parse AI response — commit not blocked.\n  ${e.message}`);
        process.exit(0);
    }
    const minRank = prompt_js_1.SEVERITY_MIN_RANK[cfg.severityLevel] ?? 1;
    let comments = parsed.file_comments
        .map(fc => ({ ...fc, priority: (0, json_js_1.enforceP3)(fc.priority, fc.comment) }))
        .filter(fc => (PRIORITY_RANK[fc.priority] ?? 1) >= minRank);
    comments = (0, skipMarkers_js_1.applyMarkers)(comments, staged, repoRoot);
    const report = {
        schema_version: 1,
        staged_files: staged,
        duration_ms: 0,
        exit_code: 0,
        lint_findings: [],
        review: {
            summary: parsed.summary,
            blocking: parsed.blocking,
            is_error: false,
            file_comments: comments,
            grade: parsed.grade,
        },
    };
    const exitCode = (0, exitResolver_js_1.resolveExitCode)(report);
    printReport(report, exitCode === 1);
    process.exit(exitCode);
}
function readConfig(repoRoot) {
    const file = path.join(repoRoot, '.commit-defender', 'hook.json');
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        return null;
    }
    return {
        aiProvider: raw.aiProvider ?? 'aoai',
        model: raw.model ?? '',
        endpoint: raw.endpoint ?? '',
        apiVersion: raw.apiVersion ?? '2024-08-01-preview',
        apiKey: raw.apiKey ?? '',
        maxTokens: Number.isFinite(+raw.maxTokens) ? +raw.maxTokens : 4096,
        severityLevel: raw.severityLevel ?? 'moderate',
        richnessLevel: raw.richnessLevel ?? 'moderate',
        locale: raw.locale ?? 'en',
        excludePatterns: Array.isArray(raw.excludePatterns) ? raw.excludePatterns : [],
        // UX fields aren't read by the hook but the type demands them.
        colorPalette: 'theme-adaptive',
        preCommitHook: 'enable',
        fileTimeoutSeconds: 0,
        directoryTimeoutSeconds: 0,
        stagedFilesWarnThreshold: 0,
        repoAnalysisWarnThreshold: 0,
        runOnStage: false,
    };
}
function listStagedFiles(repoRoot) {
    try {
        const out = (0, child_process_1.execFileSync)('git', ['-C', repoRoot, 'diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
            encoding: 'utf8',
        });
        return out.split('\n').filter(Boolean);
    }
    catch (e) {
        eprintln(`commit-defender: git diff failed — ${e.message}`);
        return [];
    }
}
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.tiff', '.tif', '.heic', '.heif', '.avif',
    '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv',
    '.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a',
    '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
    '.jar', '.war', '.ear', '.vsix', '.whl', '.egg',
    '.pyc', '.pyo', '.pyd', '.class',
    '.so', '.dll', '.dylib', '.exe', '.bin', '.o', '.a', '.wasm',
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.db', '.sqlite', '.sqlite3',
    '.parquet', '.arrow', '.avro', '.pkl', '.pickle', '.npy', '.npz',
    '.lock',
]);
function isBinary(p) {
    const ext = path.extname(p).toLowerCase();
    return ext.length > 0 && BINARY_EXTENSIONS.has(ext);
}
// ── Plain-text report (no ANSI deps; emoji is enough) ───────────────────────
const PRIORITY_LABEL = {
    P0: '🟩 P0 Praise', P1: '🟦 P1 Info', P2: '🟧 P2 Warning', P3: '🟥 P3 Critical',
};
function printReport(report, blocked) {
    const r = report.review;
    eprintln('');
    eprintln('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    eprintln(blocked ? '  🛡  commit-defender — BLOCKED' : '  🛡  commit-defender — PASS');
    if (r.grade) {
        eprintln(`  Grade: ${r.grade}`);
    }
    eprintln('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (r.summary) {
        eprintln('\nSummary:');
        eprintln(indent(r.summary, '  '));
    }
    if (r.file_comments.length > 0) {
        eprintln('\nFindings:');
        const byFile = new Map();
        for (const c of r.file_comments) {
            const list = byFile.get(c.file) ?? [];
            list.push(c);
            byFile.set(c.file, list);
        }
        for (const [file, list] of byFile) {
            eprintln(`\n  ${file}`);
            list.sort((a, b) => (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1) || a.line - b.line);
            for (const c of list) {
                const label = PRIORITY_LABEL[c.priority] ?? c.priority;
                const where = c.line > 0 ? `:${c.line}` : ' (file-level)';
                const cat = c.category ? ` [${c.category}]` : '';
                eprintln(`    ${label}${cat} ${file}${where}`);
                eprintln(indent(c.comment, '      '));
            }
        }
    }
    if (blocked) {
        eprintln('\nThis commit was blocked because at least one P3 Critical finding was raised.');
        eprintln('Fix the issues above and try again, or use `git commit --no-verify` to skip the check.');
    }
    eprintln('');
}
function eprintln(s) {
    process.stderr.write(s + '\n');
}
function indent(text, prefix) {
    return text.split('\n').map(l => prefix + l).join('\n');
}
main().catch(e => {
    eprintln(`commit-defender: unexpected error — ${e.stack ?? e}`);
    process.exit(0); // do not block commits on internal errors
});
//# sourceMappingURL=cli.js.map