/**
 * Load SKILL.md files from <repo>/.commit-defender/<name>/SKILL.md and format
 * them as a section to inject into the system prompt. Mirrors the Python
 * `_load_skills` helper.
 */

import * as fs from 'fs';
import * as path from 'path';

export function loadSkills(repoRoot: string): string {
  const skillDir = path.join(repoRoot, '.commit-defender');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillDir, { withFileTypes: true });
  } catch {
    return '';
  }

  const sections: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) { continue; }
    const skillFile = path.join(skillDir, entry.name, 'SKILL.md');
    let content: string;
    try {
      content = fs.readFileSync(skillFile, 'utf8').trim();
    } catch { continue; }
    if (!content) { continue; }
    sections.push(`### [${entry.name}]\n\n${content}`);
  }

  if (sections.length === 0) { return ''; }
  return '## Active Review Skills\n\n' + sections.join('\n\n---\n\n');
}
