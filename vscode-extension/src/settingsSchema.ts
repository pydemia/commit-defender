import { validateGitTemplate } from './gitTemplates.js';

/** Editable User Settings. Model selection and secrets use the verified native flows. */
export const settingsSections = [
  { id: 'model', label: 'Account & Model', description: 'Choose the account or API destination used to run reviews.' },
  { id: 'git', label: 'Commit Message', description: 'Control the layout of generated commit messages.' },
  { id: 'review', label: 'Review & Display', description: 'Source exclusions, review limits, feedback and finding colors.' },
  { id: 'automatic', label: 'Automatic Reviews', description: 'Global defaults for automatic review triggers and their budget.' },
  { id: 'knowledge', label: 'Memory & GCR', description: 'Local review knowledge and an optional Git Code Reviewer connection.' },
  { id: 'advanced', label: 'Profiles & Executables', description: 'Local storage profile and CLI/service executable paths.' },
] as const;
export type SettingsSection = typeof settingsSections[number]['id'];
export interface SettingsField {
  key: string;
  label: string;
  section: SettingsSection;
  help?: string;
  multiline?: boolean;
}
export const settingsFields: SettingsField[] = [
  { key: 'maxTokens', label: 'API output-token limit', section: 'model' },
  { key: 'commitMessageFormat', label: 'Commit message format', section: 'git', multiline: true,
    help: 'Literal layout rendered after generation. Use $name or ${name}; use $$ for a literal dollar sign.' },
  { key: 'excludePatterns', label: 'Source exclusions', section: 'review', help: 'One gitignore-style pattern per line. Added to repository exclusions.' },
  { key: 'fileTimeoutSeconds', label: 'Single-file timeout (seconds)', section: 'review' },
  { key: 'directoryTimeoutSeconds', label: 'Multi-file timeout (seconds)', section: 'review' },
  { key: 'stagedFilesWarnThreshold', label: 'Staged-file warning threshold', section: 'review' },
  { key: 'repoAnalysisWarnThreshold', label: 'Repository warning threshold', section: 'review' },
  { key: 'colorPalette', label: 'Finding color palette', section: 'review' },
  { key: 'severityLevel', label: 'Legacy reviewer strictness', section: 'review' },
  { key: 'richnessLevel', label: 'Legacy feedback detail', section: 'review' },
  { key: 'locale', label: 'Review language', section: 'review' },
  { key: 'runOnSave', label: 'Review saved changes', section: 'automatic' },
  { key: 'runOnStage', label: 'Review staged changes', section: 'automatic' },
  { key: 'runOnCommit', label: 'Review commits in the background', section: 'automatic' },
  { key: 'runOnPush', label: 'Review pushes in the background', section: 'automatic' },
  { key: 'reviewAutoSaves', label: 'Include VS Code Auto Save', section: 'automatic' },
  { key: 'reviewExternalChanges', label: 'Include external file changes', section: 'automatic' },
  { key: 'automaticReviewsPaused', label: 'Pause automatic reviews globally', section: 'automatic' },
  { key: 'automaticSaveIntervalSeconds', label: 'Minimum Save interval (seconds)', section: 'automatic' },
  { key: 'automaticReviewsPerHour', label: 'Maximum automatic starts per hour', section: 'automatic' },
  { key: 'hookReviewWaitSeconds', label: 'Commit/Push review wait (seconds)', section: 'automatic' },
  { key: 'reviewMode', label: 'Default review mode', section: 'knowledge', help: 'Centralized mode requires an explicit connection for each profile and worktree. Selecting a mode does not connect or grant access.' },
  { key: 'localProfile', label: 'Local profile', section: 'advanced', help: 'Changing profile selects separate knowledge, history and API credentials. Reconfigure a destination-bound API key after switching profile.' },
  { key: 'codexPath', label: 'Codex CLI', section: 'advanced' },
  { key: 'claudeCodePath', label: 'Claude Code CLI', section: 'advanced' },
  { key: 'antigravityPath', label: 'Antigravity agent CLI', section: 'advanced' },
  { key: 'serviceNodePath', label: 'Background service Node.js (22+)', section: 'advanced' },
];
export interface SettingDefinition {
  type: string;
  default?: unknown;
  enum?: unknown[];
  enumItemLabels?: string[];
  description?: string;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  scope?: string;
}
export type SettingsDefinitions = Record<string, SettingDefinition>;
export function isSettingsSection(value: unknown): value is SettingsSection {
  return settingsSections.some(section => section.id === value);
}
/** Validate the whole request before writing any key. No credentials or hook policy here. */
export function validateSettingsChanges(
  changes: unknown,
  section: unknown,
  definitions: SettingsDefinitions,
): Record<string, unknown> {
  if (!isSettingsSection(section) || !changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw Error('invalid-settings');
  }
  const entries = Object.entries(changes);
  if (!entries.length || entries.length > settingsFields.length) throw Error('invalid-settings');
  for (const [key, value] of entries) {
    const field = settingsFields.find(item => item.key === key && item.section === section);
    const spec = definitions[`commitDefender.${key}`];
    if (!field || !spec) throw Error('invalid-settings');
    if (spec.enum && !spec.enum.includes(value)) throw Error('invalid-settings');
    if (spec.type === 'boolean' && typeof value !== 'boolean') throw Error('invalid-settings');
    if (spec.type === 'number' || spec.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value)
        || value < (spec.minimum ?? 0) || value > (spec.maximum ?? 1_000_000)) throw Error('invalid-settings');
      if (key.endsWith('TimeoutSeconds') && value > 600) throw Error('invalid-settings');
    }
    if (spec.type === 'string') {
      const multiline = key === 'commitMessageFormat';
      if (typeof value !== 'string' || value.length > 4096
        || (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) : /[\x00-\x1f\x7f]/.test(value))
        || (spec.pattern && !new RegExp(spec.pattern).test(value))) throw Error('invalid-settings');
      if (key.endsWith('Path') && !value.trim()) throw Error('invalid-settings');
      if (key === 'commitMessageFormat' && validateGitTemplate(value)) throw Error('invalid-settings');
    }
    if (spec.type === 'array' && (!Array.isArray(value) || value.length > 100
      || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 1024 || /[\x00-\x1f]/.test(item)))) {
      throw Error('invalid-settings');
    }
  }
  return Object.fromEntries(entries);
}
