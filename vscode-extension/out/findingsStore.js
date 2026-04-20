"use strict";
/**
 * FindingsStore — in-memory registry of the latest analysis results.
 *
 * Stores CommentBlock[] (from normalizeReport) indexed by file URI + 0-based line.
 * CodeLensProvider and other consumers query this store.
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
const commentFormatter_js_1 = require("./commentFormatter.js");
class FindingsStore {
    _data = new Map();
    _last;
    /** Fires whenever the store is updated or cleared. */
    onDidChange = new vscode.EventEmitter();
    /** Populate the store from a completed AnalysisReport. */
    update(report, repoRoot) {
        const blocks = (0, commentFormatter_js_1.normalizeReport)(report);
        this._last = { report, repoRoot, blocks };
        this._data.clear();
        for (const b of blocks) {
            if (b.line <= 0) {
                continue;
            }
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
    get(uri) {
        return this._data.get(uri.toString());
    }
    /** Return the most recent report + repoRoot + blocks, or undefined if none yet. */
    lastReport() {
        return this._last;
    }
    clear() {
        this._data.clear();
        this._last = undefined;
        this.onDidChange.fire();
    }
    _getOrCreate(uriKey) {
        let set = this._data.get(uriKey);
        if (!set) {
            set = { byLine: new Map() };
            this._data.set(uriKey, set);
        }
        return set;
    }
}
/** Singleton shared across the extension lifetime. */
exports.findingsStore = new FindingsStore();
//# sourceMappingURL=findingsStore.js.map