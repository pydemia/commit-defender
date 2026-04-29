"use strict";
/**
 * Top-level AI review orchestrator. Replaces the Python `AIReviewAgent`.
 *
 * Two entry points:
 *   reviewDiff()             — combined staged diff (pre-commit + staged scope)
 *   reviewFilesSeparately()  — one AI call per file (on-demand scopes)
 *
 * Both produce an AnalysisReport in the same JSON shape the rest of the
 * extension already consumes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveExitCode = exports.Reviewer = void 0;
const diff_js_1 = require("../diff.js");
const exitResolver_js_1 = require("../exitResolver.js");
Object.defineProperty(exports, "resolveExitCode", { enumerable: true, get: function () { return exitResolver_js_1.resolveExitCode; } });
const skipMarkers_js_1 = require("../skipMarkers.js");
const skills_js_1 = require("../skills.js");
const json_js_1 = require("./json.js");
const prompt_js_1 = require("./prompt.js");
const providers_js_1 = require("./providers.js");
const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
const GRADE_RANK = {
    exceptional: 5, proficient: 4, adequate: 3, insufficient: 2, critical: 1,
};
class Reviewer {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    /** Pre-commit / staged scope: send the combined diff in a single call. */
    async reviewDiff(repoRoot, stagedFiles, signal) {
        const start = Date.now();
        try {
            const diff = await (0, diff_js_1.getStagedDiff)(repoRoot, stagedFiles);
            const review = await this.singleCall({
                repoRoot, mode: 'diff', body: diff, signal,
            });
            review.file_comments = (0, skipMarkers_js_1.applyMarkers)(review.file_comments, stagedFiles, repoRoot);
            const report = this.assembleReport(stagedFiles, review, Date.now() - start);
            return { report, stderr: '', timedOut: false, cancelled: false };
        }
        catch (e) {
            if (e.name === 'AbortError') {
                return { report: this.emptyReport('Cancelled'), stderr: '', timedOut: false, cancelled: true };
            }
            return { report: this.errorReport(e.message), stderr: '', timedOut: false, cancelled: false };
        }
    }
    /** On-demand scope: one AI call per file, then merge. */
    async reviewFilesSeparately(repoRoot, relPaths, signal, onProgress) {
        const start = Date.now();
        const allComments = [];
        const perFile = [];
        const summaries = [];
        const grades = [];
        let blocking = false;
        const isMeaningful = (s) => Boolean(s) && s !== '(no summary)' && s !== 'AI review skipped';
        for (let i = 0; i < relPaths.length; i++) {
            if (signal?.aborted) {
                return { report: this.emptyReport('Cancelled'), stderr: '', timedOut: false, cancelled: true };
            }
            const rel = relPaths[i];
            onProgress?.(i + 1, relPaths.length, rel);
            const content = (0, diff_js_1.getFileContents)(repoRoot, [rel]);
            let result;
            try {
                result = await this.singleCall({ repoRoot, mode: 'file', body: content, signal });
            }
            catch (e) {
                if (e.name === 'AbortError') {
                    return { report: this.emptyReport('Cancelled'), stderr: '', timedOut: false, cancelled: true };
                }
                result = this.errorResult(e.message);
            }
            result.file_comments = (0, skipMarkers_js_1.applyMarkers)(result.file_comments, [rel], repoRoot);
            if (result.is_error) {
                const errText = `⚠ ${result.summary}`;
                summaries.push(`**\`${rel}\`** — ${errText}`);
                perFile.push({ file: rel, summary: errText, priority: 'P3', blocking: false, grade: result.grade });
                continue;
            }
            blocking = blocking || result.blocking;
            // Rewrite each comment's `file` to the repo-relative path of the file we
            // sent (the model may echo back a different path it inferred from the
            // header) so downstream rendering points to the correct file.
            const filePriority = pickFilePriority(result);
            for (const fc of result.file_comments) {
                allComments.push({ ...fc, file: rel });
            }
            if (result.file_comments.length === 0 && isMeaningful(result.summary)) {
                allComments.push({
                    file: rel, line: 1, comment: result.summary, category: '', priority: filePriority,
                });
            }
            grades.push(result.grade);
            if (isMeaningful(result.summary)) {
                summaries.push(`**\`${rel}\`**\n\n${result.summary}`);
                perFile.push({
                    file: rel,
                    summary: result.summary,
                    priority: filePriority,
                    blocking: result.blocking,
                    grade: result.grade,
                });
            }
        }
        const review = (summaries.length === 0 && allComments.length === 0)
            ? { summary: 'AI review produced no output.', blocking: false, is_error: false, file_comments: [], grade: '' }
            : {
                summary: summaries.join('\n\n---\n\n'),
                blocking,
                is_error: false,
                file_comments: allComments,
                grade: worstGrade(grades) || '',
                per_file_summaries: perFile,
            };
        const report = this.assembleReport(relPaths, review, Date.now() - start);
        return { report, stderr: '', timedOut: false, cancelled: false };
    }
    /** Generate a conventional commit message from the current staged diff. */
    async generateCommitMessage(repoRoot, signal) {
        let diff;
        try {
            diff = (await (0, diff_js_1.git)(repoRoot, ['diff', '--cached'])).trim();
        }
        catch (e) {
            return { commit_message: '', is_error: true, error: `git diff failed: ${e.message}` };
        }
        if (!diff) {
            return { commit_message: '', is_error: true, error: 'No staged changes found.' };
        }
        const req = this.buildProviderRequest(prompt_js_1.COMMIT_MESSAGE_SYSTEM_PROMPT, `Generate a commit message for the following staged diff:\n\n\`\`\`diff\n${diff}\n\`\`\``, Math.min(this.cfg.maxTokens, 512), signal);
        const resp = await (0, providers_js_1.callProvider)(req);
        if (resp.error) {
            return { commit_message: '', is_error: true, error: resp.error };
        }
        let parsed;
        try {
            const stripped = resp.raw.trim()
                .replace(/^```(?:json)?\s*/m, '')
                .replace(/```\s*$/m, '')
                .trim();
            parsed = JSON.parse(stripped);
        }
        catch (e) {
            return { commit_message: '', is_error: true, error: `Failed to parse model response: ${e.message}` };
        }
        const msg = String(parsed?.commit_message ?? '').trim();
        if (!msg) {
            return { commit_message: '', is_error: true, error: 'Model returned an empty commit_message.' };
        }
        return { commit_message: msg, is_error: false, error: '' };
    }
    // ── Internals ─────────────────────────────────────────────────────────────
    async singleCall(opts) {
        const skillsText = (0, skills_js_1.loadSkills)(opts.repoRoot);
        const systemPrompt = (0, prompt_js_1.buildSystemPrompt)({
            mode: opts.mode,
            severity: this.cfg.severityLevel,
            richness: this.cfg.richnessLevel,
            locale: this.cfg.locale,
            skillsText,
        });
        const userMessage = (0, prompt_js_1.buildUserMessage)(opts.mode, opts.body);
        const req = this.buildProviderRequest(systemPrompt, userMessage, this.cfg.maxTokens, opts.signal);
        const resp = await (0, providers_js_1.callProvider)(req);
        if (resp.error) {
            return this.errorResult(resp.error);
        }
        let parsed;
        try {
            parsed = (0, json_js_1.parseReviewJson)(resp.raw);
        }
        catch (e) {
            return this.errorResult(`Could not parse AI response as JSON (max_tokens=${this.cfg.maxTokens}). ` +
                `Raw response head: ${resp.raw.slice(0, 200)}`);
        }
        // Apply P3 text-pattern upgrade and enforce severity floor
        const minRank = prompt_js_1.SEVERITY_MIN_RANK[this.cfg.severityLevel] ?? 1;
        let comments = parsed.file_comments
            .map(fc => ({
            ...fc,
            priority: (0, json_js_1.enforceP3)(fc.priority, fc.comment),
        }))
            .filter(fc => (PRIORITY_RANK[fc.priority] ?? 1) >= minRank);
        // Moderate: cap P1 Info at 2 per file so it doesn't drown out P2/P3
        if (this.cfg.severityLevel === 'moderate') {
            const counts = new Map();
            comments = comments.filter(fc => {
                if (fc.priority !== 'P1') {
                    return true;
                }
                const n = (counts.get(fc.file) ?? 0) + 1;
                counts.set(fc.file, n);
                return n <= 2;
            });
        }
        let summary = parsed.summary;
        if (parsed.truncated) {
            summary = `⚠ Response truncated (max_tokens=${this.cfg.maxTokens}) — ` +
                `increase \`commitDefender.maxTokens\` for a complete review.\n\n${summary}`;
        }
        return {
            summary,
            blocking: parsed.blocking,
            is_error: false,
            file_comments: comments,
            grade: parsed.grade,
        };
    }
    buildProviderRequest(systemPrompt, userMessage, maxTokens, signal) {
        return {
            provider: this.cfg.aiProvider,
            apiKey: this.cfg.apiKey,
            endpoint: this.cfg.endpoint,
            apiVersion: this.cfg.apiVersion,
            model: this.cfg.model,
            maxTokens,
            systemPrompt,
            userMessage,
            signal,
        };
    }
    assembleReport(stagedFiles, review, durationMs) {
        const exit_code = review.is_error ? 0 : (review.file_comments.some(c => c.priority === 'P3') ? 1 : (review.blocking ? 1 : 0));
        return {
            schema_version: 1,
            staged_files: stagedFiles,
            duration_ms: durationMs,
            exit_code: exit_code,
            lint_findings: [],
            review,
        };
    }
    emptyReport(summary) {
        return {
            schema_version: 1,
            staged_files: [],
            duration_ms: 0,
            exit_code: 0,
            lint_findings: [],
            review: { summary, blocking: false, is_error: false, file_comments: [], grade: '' },
        };
    }
    errorReport(message) {
        return {
            schema_version: 1,
            staged_files: [],
            duration_ms: 0,
            exit_code: 0,
            lint_findings: [],
            review: this.errorResult(message),
        };
    }
    errorResult(message) {
        return {
            summary: `AI review unavailable: ${message}`,
            blocking: false,
            is_error: true,
            file_comments: [],
            grade: '',
        };
    }
}
exports.Reviewer = Reviewer;
// ── Helpers ───────────────────────────────────────────────────────────────────
function pickFilePriority(result) {
    if (result.file_comments.length > 0) {
        let worst = 'P0';
        for (const fc of result.file_comments) {
            if ((PRIORITY_RANK[fc.priority] ?? 1) > (PRIORITY_RANK[worst] ?? 1)) {
                worst = fc.priority;
            }
        }
        return worst;
    }
    if (result.blocking) {
        return 'P3';
    }
    if (result.grade === 'critical' || result.grade === 'insufficient') {
        return 'P2';
    }
    return 'P1';
}
function worstGrade(grades) {
    let worst = '';
    let worstRank = Number.POSITIVE_INFINITY;
    for (const g of grades) {
        const rank = GRADE_RANK[g];
        if (rank !== undefined && rank < worstRank) {
            worstRank = rank;
            worst = g;
        }
    }
    return worst;
}
//# sourceMappingURL=reviewer.js.map