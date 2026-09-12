import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { buildIgnore } from './excludeFilter.js';

export type SourceExclusionReason =
  | 'invalid-path' | 'private-data' | 'generated' | 'binary'
  | 'user-excluded' | 'git-ignored' | 'symlink' | 'not-file' | 'unreadable';
export interface SourceExclusion { path: string; reason: SourceExclusionReason }
export interface SourceSelection { files: string[]; excluded: SourceExclusion[] }
export type ExclusionObserver = (entry: SourceExclusion) => void;

export const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', '.venv', 'venv', 'env', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.svelte-kit', 'coverage', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  'vendor', '.tox', 'artifacts', 'test-results', 'playwright-report', '.vscode-test', '.impeccable',
]);
const PRIVATE_DIRS = new Set([
  '.git', '.gcr', '.commit-defender', '.ssh', '.aws', '.azure', '.kube', '.claude', '.gemini', '.vscode',
]);
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp', '.tiff', '.tif', '.heic', '.heif', '.avif',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar', '.jar', '.war', '.ear', '.vsix', '.whl', '.egg', '.tgz',
  '.pyc', '.pyo', '.pyd', '.class', '.so', '.dll', '.dylib', '.exe', '.bin', '.o', '.a', '.wasm',
  '.ttf', '.otf', '.woff', '.woff2', '.eot', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.db', '.sqlite', '.sqlite3', '.parquet', '.arrow', '.avro', '.pkl', '.pickle', '.npy', '.npz', '.lock',
]);

export function isBinary(file: string): boolean {
  return BINARY_EXTENSIONS.has(path.posix.extname(file).toLowerCase());
}

export function normalizedSourcePath(value: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = path.sep === '\\' ? value.replaceAll('\\', '/') : value;
  if (!normalized || /[\x00-\x1f\x7f\\]/.test(normalized)
      || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)
      || normalized.split('/').some(part => !part || part === '.' || part === '..')) return undefined;
  return normalized;
}

export interface SourcePolicyOptions {
  allowMissing?: boolean;
  allowDirectories?: boolean;
  purpose?: 'source' | 'skill';
  /** The caller validates immutable Git entry modes instead of working-tree metadata. */
  gitTree?: boolean;
}

/** Metadata-only policy. Contents are read only after this check succeeds. */
export function selectReviewInputs(
  repoRoot: string, inputs: string[], excludePatterns: string[] = [], options: SourcePolicyOptions = {},
): SourceSelection {
  const root = fs.realpathSync(repoRoot);
  const excludes = buildIgnore(excludePatterns);
  const files: string[] = [];
  const excluded: SourceExclusion[] = [];
  for (const raw of new Set(inputs)) {
    const file = normalizedSourcePath(raw);
    const deny = (reason: SourceExclusionReason) => excluded.push({ path: file ?? raw, reason });
    if (!file) { deny('invalid-path'); continue; }
    const parts = file.split('/');
    const name = parts[parts.length - 1].toLowerCase();
    const skill = options.purpose === 'skill' && /^\.commit-defender\/[^/]+\/SKILL\.md$/.test(file);
    if (parts.some(part => (PRIVATE_DIRS.has(part.toLowerCase()) && !(skill && part === '.commit-defender')) || part.toLowerCase().startsWith('.codex'))
        || /^(?:\.env(?:\..*)?|\.envrc|\.npmrc|\.pypirc|\.netrc|auth\.json(?:\..*)?|credentials(?:\.json)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?)$/.test(name)
        || /\.(?:env|pem|key|p12|pfx|keystore|code-workspace)$/.test(name)) {
      deny('private-data'); continue;
    }
    if (parts.some(part => SKIP_DIRS.has(part.toLowerCase()))) { deny('generated'); continue; }
    if (isBinary(file)) { deny('binary'); continue; }
    if (excludes.ignores(file)) { deny('user-excluded'); continue; }

    let denied = false;
    for (let index = 0; !options.gitTree && index < parts.length; index++) {
      try {
        const stat = fs.lstatSync(path.join(root, ...parts.slice(0, index + 1)));
        if (stat.isSymbolicLink()) { deny('symlink'); denied = true; break; }
        if (index < parts.length - 1 ? !stat.isDirectory() : !(stat.isFile() || (options.allowDirectories && stat.isDirectory()))) {
          deny('not-file'); denied = true; break;
        }
      } catch (error) {
        if (options.allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') break;
        deny('unreadable'); denied = true; break;
      }
    }
    if (!denied) files.push(file);
  }

  if (files.length === 0) return { files, excluded };
  let output = '';
  try {
    // --no-index is intentional: tracked/force-added files must still obey ignore policy.
    // check-ignore rejects literal pathspec magic. ./ keeps a leading colon a filename.
    output = execFileSync('git', ['-C', repoRoot, 'check-ignore', '--no-index', '-z', '--stdin'], {
      input: files.map(file => `./${file}`).join('\0') + '\0', encoding: 'utf8',
      env: { ...process.env, GIT_LITERAL_PATHSPECS: '0', GIT_GLOB_PATHSPECS: '0', GIT_NOGLOB_PATHSPECS: '0', GIT_ICASE_PATHSPECS: '0' },
      maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    if ((error as { status?: number }).status !== 1) throw new Error('Unable to evaluate repository ignore policy');
  }
  const ignored = new Set(output.split('\0').filter(Boolean).map(file => file.replace(/^\.\//, '')));
  return {
    files: files.filter(file => {
      if (!ignored.has(file)) return true;
      excluded.push({ path: file, reason: 'git-ignored' });
      return false;
    }),
    excluded,
  };
}

/** Re-check a selected path at the read boundary and refuse symlink final components. */
export function readReviewFile(repoRoot: string, file: string, patterns: string[] = [], purpose: 'source' | 'skill' = 'source'): string {
  const selection = selectReviewInputs(repoRoot, [file], patterns, { purpose });
  if (selection.files.length !== 1) throw new Error(`Source excluded: ${file} (${selection.excluded[0]?.reason ?? 'unreadable'})`);
  const absolute = path.join(fs.realpathSync(repoRoot), selection.files[0]);
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    const current = fs.statSync(absolute);
    if (!opened.isFile() || fs.realpathSync(absolute) !== absolute || current.dev !== opened.dev || current.ino !== opened.ino) {
      throw new Error(`Source path changed while opening: ${file}`);
    }
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}
