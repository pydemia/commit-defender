"use strict";
/**
 * Load SKILL.md files from <repo>/.commit-defender/<name>/SKILL.md and format
 * them as a section to inject into the system prompt. Mirrors the Python
 * `_load_skills` helper.
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
exports.loadSkills = loadSkills;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function loadSkills(repoRoot) {
    const skillDir = path.join(repoRoot, '.commit-defender');
    let entries;
    try {
        entries = fs.readdirSync(skillDir, { withFileTypes: true });
    }
    catch {
        return '';
    }
    const sections = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) {
            continue;
        }
        const skillFile = path.join(skillDir, entry.name, 'SKILL.md');
        let content;
        try {
            content = fs.readFileSync(skillFile, 'utf8').trim();
        }
        catch {
            continue;
        }
        if (!content) {
            continue;
        }
        sections.push(`### [${entry.name}]\n\n${content}`);
    }
    if (sections.length === 0) {
        return '';
    }
    return '## Active Review Skills\n\n' + sections.join('\n\n---\n\n');
}
//# sourceMappingURL=skills.js.map