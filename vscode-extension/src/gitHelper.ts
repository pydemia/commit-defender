import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { applyExcludes } from './excludeFilter.js';

/**
 * Binary file extensions that cannot be meaningfully reviewed.
 * Every other file — any text format — is accepted for analysis.
 */
const BINARY_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.tiff', '.tif', '.heic', '.heif', '.avif',
  // Video / audio
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv',
  '.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a',
  // Archives / packages
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  '.jar', '.war', '.ear', '.vsix', '.whl', '.egg',
  // Compiled / native binaries
  '.pyc', '.pyo', '.pyd', '.class',
  '.so', '.dll', '.dylib', '.exe', '.bin', '.o', '.a', '.wasm',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // Office / documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Database / data blobs
  '.db', '.sqlite', '.sqlite3',
  '.parquet', '.arrow', '.avro', '.pkl', '.pickle', '.npy', '.npz',
  // Lock files (auto-generated, not useful to review)
  '.lock',
]);

/**
 * Directories that are always skipped during filesystem walks.
 */
export const SKIP_DIRS = new Set([
  '.git', 'node_modules', '__pycache__',
  '.venv', 'venv', 'env',
  'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.svelte-kit',
  'coverage', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  'vendor', '.tox',
]);

/**
 * Returns true when a file is binary and should be excluded from analysis.
 * Files with no extension (Dockerfile, Makefile, .bashrc, etc.) are accepted.
 */
export function isBinary(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) { return false; }   // no-extension files are text
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Filter a list of repo-relative paths to only those worth analyzing.
 * Rejects known binary extensions; accepts everything else.
 */
export function filterForAnalysis(files: string[]): string[] {
  return files.filter(f => !isBinary(f));
}

/**
 * Recursively collect all analyzable files under `dirPath`,
 * returning repo-relative paths. Skips noise directories, binary files,
 * and any paths matched by `excludePatterns` (gitignore-style).
 */
export function collectFiles(dirPath: string, repoRoot: string, excludePatterns: string[] = []): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Skip hidden dirs except a small allow-list
        if (entry.name.startsWith('.') &&
            entry.name !== '.github' &&
            entry.name !== '.commit-defender') {
          continue;
        }
        if (SKIP_DIRS.has(entry.name)) { continue; }
        walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(repoRoot, fullPath);
        if (!rel.startsWith('..') && !isBinary(rel)) {
          results.push(rel);
        }
      }
    }
  }

  walk(dirPath);
  return applyExcludes(results, excludePatterns);
}

/** Returns the canonical repo root for the given directory. */
export function getRepoRoot(cwd: string): Promise<string> {
  return execGit(['rev-parse', '--show-toplevel'], cwd);
}

/**
 * Returns repo-relative paths of currently staged (ACMR) files, filtered to
 * non-binary types and to anything matched by the user's excludePatterns.
 */
export async function getStagedFiles(repoRoot: string, excludePatterns: string[] = []): Promise<string[]> {
  const output = await execGit(
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    repoRoot
  );
  const all = output.split('\n').filter(Boolean);
  return applyExcludes(filterForAnalysis(all), excludePatterns);
}

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`git ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`));
      }
    });
    proc.on('error', reject);
  });
}
