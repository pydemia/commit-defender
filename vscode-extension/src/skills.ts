/**
 * Load SKILL.md files from <repo>/.commit-defender/<name>/SKILL.md and format
 * them as a section to inject into the system prompt. Mirrors the Python
 * `_load_skills` helper.
 */

import * as fs from 'fs';
import * as path from 'path';
import { readReviewFile, selectReviewInputs } from './sourcePolicy.js';

export function loadSkills(repoRoot: string, excludePatterns: string[] = []): string {
  const skillDir = path.join(repoRoot, '.commit-defender');
  let entries: fs.Dirent[];
  try {
    if (fs.lstatSync(skillDir).isSymbolicLink()) return '';
    entries = fs.readdirSync(skillDir, { withFileTypes: true });
  } catch {
    return '';
  }

  const sections: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) { continue; }
    const skillFile = `.commit-defender/${entry.name}/SKILL.md`;
    if (!selectReviewInputs(repoRoot, [skillFile], excludePatterns, { purpose: 'skill' }).files.length) continue;
    let content: string;
    try {
      content = readReviewFile(repoRoot, skillFile, excludePatterns, 'skill').trim();
    } catch { continue; }
    if (!content) { continue; }
    sections.push(`### [${entry.name}]\n\n${content}`);
  }

  if (sections.length === 0) { return ''; }
  return '## Active Review Skills\n\n' + sections.join('\n\n---\n\n');
}
