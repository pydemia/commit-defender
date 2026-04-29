"use strict";
/**
 * Apply commitDefender.excludePatterns (gitignore-style) on top of an already
 * git-filtered file list. The repo's own .gitignore is honoured automatically
 * by `git diff --cached`; this filter exists to drop additional paths the user
 * has flagged via VS Code settings.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildIgnore = buildIgnore;
exports.applyExcludes = applyExcludes;
const ignore_1 = __importDefault(require("ignore"));
function buildIgnore(patterns) {
    const ig = (0, ignore_1.default)();
    if (patterns.length > 0) {
        ig.add(patterns);
    }
    return ig;
}
function applyExcludes(relPaths, patterns) {
    if (patterns.length === 0) {
        return relPaths;
    }
    const ig = buildIgnore(patterns);
    return relPaths.filter(p => !ig.ignores(p));
}
//# sourceMappingURL=excludeFilter.js.map