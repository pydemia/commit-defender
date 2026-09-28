import { execFileSync } from 'node:child_process';

export const DEFAULT_COMMIT_MESSAGE_FORMAT = '[$type] $title\n\n$body';

export const COMMIT_TEMPLATE_VARIABLES = [
  'type', 'scope', 'title', 'body', 'branch', 'branchId', 'issueId', 'prId', 'commitId', 'date',
] as const;
export type CommitTemplateVariable = typeof COMMIT_TEMPLATE_VARIABLES[number];
export type GitTemplateVariable = CommitTemplateVariable;
export type GitTemplateValues = Partial<Record<GitTemplateVariable, string>>;

export interface CommitMessageParts {
  type: string;
  scope: string;
  title: string;
  body: string;
}

const PLACEHOLDER = /\$(?:\{([a-z][a-zA-Z0-9]*)\}|([a-z][a-zA-Z0-9]*))/g;
const ESCAPED_DOLLAR = '\u0001';
const TYPES = new Map([
  ['feature', 'Feature'], ['improve', 'Improve'], ['fix', 'Fix'], ['doc', 'Doc'],
  ['refactor', 'Refactor'], ['test', 'Test'], ['chore', 'Chore'],
]);

export function templateVariables(template: string): string[] {
  return [...template.replace(/\$\$/g, ESCAPED_DOLLAR).matchAll(PLACEHOLDER)]
    .map(match => match[1] ?? match[2]);
}

export function validateGitTemplate(template: string): string | undefined {
  if (!template.trim()) return 'A pattern is required.';
  if (template.length > 4096 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(template)) {
    return 'The pattern contains unsupported control characters.';
  }
  const allowed = new Set<string>(COMMIT_TEMPLATE_VARIABLES);
  const variables = templateVariables(template);
  const unknown = variables.find(variable => !allowed.has(variable));
  if (unknown) return `Unknown variable: $${unknown}`;
  if (!variables.includes('title')) return 'The commit format must include $title.';
  return undefined;
}

export function renderGitTemplate(template: string, values: GitTemplateValues): string {
  return template.replace(/\$\$/g, ESCAPED_DOLLAR).replace(PLACEHOLDER, (_whole, braced, plain) => {
    const variable = (braced ?? plain) as GitTemplateVariable;
    const value = values[variable];
    if (value === undefined) throw Error(`missing-template-variable:${variable}`);
    return value;
  }).replaceAll(ESCAPED_DOLLAR, '$');
}

function gitValue(repoRoot: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    }).trim();
  } catch { return ''; }
}

export function readGitTemplateValues(repoRoot: string): GitTemplateValues {
  const branch = gitValue(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const commitId = gitValue(repoRoot, ['rev-parse', '--short=12', 'HEAD']);
  const branchId = branch.match(/(?:^|[\/_-])(\d+)(?=$|[\/_-])/)?.[1] ?? '';
  const issueId = branch.match(/(?:^|[\/_-])(?:issue|issues|gh)[\/_-]?(\d+)(?=$|[\/_-])/i)?.[1] ?? branchId;
  const prId = branch.match(/(?:^|[\/_-])(?:pr|pull)[\/_-]?(\d+)(?=$|[\/_-])/i)?.[1] ?? '';
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
    branch: branch || undefined, branchId: branchId || undefined,
    issueId: issueId || undefined, prId: prId || undefined,
    commitId: commitId || undefined, date,
  };
}

export function unavailableRepositoryVariables(template: string, repoRoot: string): string[] {
  const generated = new Set(['type', 'scope', 'title', 'body']);
  const values = readGitTemplateValues(repoRoot);
  return [...new Set(templateVariables(template))]
    .filter(variable => !generated.has(variable) && values[variable as GitTemplateVariable] === undefined);
}

function normalizedType(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/^\[|\]$/g, '');
  return TYPES.get(raw.toLowerCase()) ?? raw;
}

export function parseCommitMessage(message: string): Partial<CommitMessageParts> {
  const [first = '', ...rest] = message.trim().split(/\r?\n/);
  const body = rest.join('\n').trim();
  const bracket = first.match(/^\[([^\]]+)]\s*(.+)$/);
  if (bracket) return { type: normalizedType(bracket[1]), scope: '', title: bracket[2].trim(), body };
  const conventional = first.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  if (conventional) return {
    type: normalizedType(conventional[1]), scope: conventional[2]?.trim() ?? '',
    title: conventional[3].trim(), body,
  };
  return { title: first.trim(), body };
}

export function commitMessageParts(value: Record<string, unknown>): CommitMessageParts | undefined {
  const fallback = parseCommitMessage(String(value.commit_message ?? ''));
  const type = normalizedType(value.type ?? fallback.type);
  const title = String(value.title ?? fallback.title ?? '').trim().replace(/[\r\n]+/g, ' ');
  const body = String(value.body ?? fallback.body ?? '').trim();
  const scope = String(value.scope ?? fallback.scope ?? '').trim().replace(/[\r\n]+/g, ' ');
  if (!type || !title) return undefined;
  return { type, title, body, scope };
}

export function commitTemplateValues(repoRoot: string, parts: CommitMessageParts): GitTemplateValues {
  return {
    ...readGitTemplateValues(repoRoot), ...parts,
    type: normalizedType(parts.type),
  };
}
