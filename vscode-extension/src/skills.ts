/**
 * Load SKILL.md files from <repo>/.commit-defender/<name>/SKILL.md and format
 * them as untrusted review material. They cannot configure providers or tools.
 */

import * as fs from 'fs';
import * as path from 'path';
import { readReviewFile, selectReviewInputs } from './sourcePolicy.js';

export function loadSkills(repoRoot: string, excludePatterns: string[] = []): string {
  return loadSkillMaterial(repoRoot, excludePatterns).text;
}

export function loadSkillMaterial(repoRoot: string, excludePatterns: string[] = []): { text: string; truncated: boolean } {
  const skillDir = path.join(repoRoot, '.commit-defender');
  let entries: fs.Dirent[];
  try {
    if (fs.lstatSync(skillDir).isSymbolicLink()) return { text: '', truncated: false };
    entries = fs.readdirSync(skillDir, { withFileTypes: true });
  } catch {
    return { text: '', truncated: false };
  }

  const sections: { path: string; content: string }[] = [];
  let remaining = 32_000;
  let truncated = false;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) { continue; }
    const skillFile = `.commit-defender/${entry.name}/SKILL.md`;
    if (!selectReviewInputs(repoRoot, [skillFile], excludePatterns, { purpose: 'skill' }).files.length) continue;
    let content: string;
    try {
      content = readReviewFile(repoRoot, skillFile, excludePatterns, 'skill').trim();
    } catch { continue; }
    if (!content) { continue; }
    if (remaining === 0) { truncated = true; break; }
    const selected = content.slice(0, remaining);
    truncated ||= selected.length < content.length;
    sections.push({ path: skillFile, content: selected });
    remaining -= selected.length;
  }

  if (sections.length === 0) { return { text: '', truncated: false }; }
  return { text: JSON.stringify({ kind: 'untrusted-repository-review-material', entries: sections, truncated }), truncated };
}
