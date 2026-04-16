"use strict";
/**
 * FindingsStore — in-memory registry of the latest analysis results.
 *
 * Both the CodeLensProvider and HoverProvider query this store so they
 * always reflect the most recent `commitDefender.analyze` run.
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
exports.findingsStore = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
class FindingsStore {
    _data = new Map();
    _last;
    /** Fires whenever the store is updated or cleared. */
    onDidChange = new vscode.EventEmitter();
    /** Populate the store from a completed AnalysisReport. */
    update(report, repoRoot) {
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
    get(uri) {
        return this._data.get(uri.toString());
    }
    /** Return the most recent report + repoRoot, or undefined if none yet. */
    lastReport() {
        return this._last;
    }
    clear() {
        this._data.clear();
        this.onDidChange.fire();
    }
    _getOrCreate(uriKey) {
        let set = this._data.get(uriKey);
        if (!set) {
            set = { lintByLine: new Map(), commentByLine: new Map() };
            this._data.set(uriKey, set);
        }
        return set;
    }
}
/** Singleton shared across the extension lifetime. */
exports.findingsStore = new FindingsStore();
//# sourceMappingURL=findingsStore.js.map