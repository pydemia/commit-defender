/**
 * Apply commitDefender.excludePatterns (gitignore-style) on top of an already
 * git-filtered file list. The repo's own .gitignore is honoured automatically
 * by `git diff --cached`; this filter exists to drop additional paths the user
 * has flagged via VS Code settings.
 */

import ignore, { Ignore } from 'ignore';

export function buildIgnore(patterns: string[]): Ignore {
  const ig = ignore();
  if (patterns.length > 0) { ig.add(patterns); }
  return ig;
}

export function applyExcludes(relPaths: string[], patterns: string[]): string[] {
  if (patterns.length === 0) { return relPaths; }
  const ig = buildIgnore(patterns);
  return relPaths.filter(p => !ig.ignores(p));
}
