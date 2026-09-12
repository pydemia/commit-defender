/**
 * Apply commitDefender.excludePatterns (gitignore-style) on top of an already
 * validated repo-relative file list. Git ignore rules, including rules for
 * force-added tracked paths, are evaluated separately by sourcePolicy.ts.
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
