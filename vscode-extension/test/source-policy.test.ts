import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Reviewer } from '../src/ai/reviewer.js';
import type { ResolvedConfig } from '../src/config.js';
import { getFileContents, getStagedDiff } from '../src/diff.js';
import { collectFiles, getStagedSelection } from '../src/gitHelper.js';
import { loadSkills } from '../src/skills.js';
import { readReviewFile, selectReviewInputs, type SourceExclusion } from '../src/sourcePolicy.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'cd-source-policy-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Source Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  const write = (file: string, body: string) => {
    const target = path.join(repo, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  };
  const capture = path.join(root, 'capture.jsonl');
  const executable = path.join(root, 'fake-codex');
  fs.writeFileSync(executable, `#!/usr/bin/env node\nconst fs = require('node:fs');\nlet text=''; process.stdin.on('data', chunk => text += chunk); process.stdin.on('end', () => { fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify(text)+'\\n'); process.stdout.write(JSON.stringify({summary:'Reviewed supplied source.',blocking:false,grade:'proficient',file_comments:[]})); });\n`);
  fs.chmodSync(executable, 0o700);
  const cfg: ResolvedConfig = {
    aiProvider: 'codex', apiKey: '', endpoint: '', apiVersion: '', model: '',
    codexPath: executable, claudeCodePath: '', geminiCliPath: '', antigravityPath: '',
    maxTokens: 4096, severityLevel: 'moderate', richnessLevel: 'moderate', locale: 'en',
    excludePatterns: [], colorPalette: 'theme-adaptive', preCommitHook: 'disable',
    fileTimeoutSeconds: 0, directoryTimeoutSeconds: 0, stagedFilesWarnThreshold: 0,
    repoAnalysisWarnThreshold: 0, runOnStage: false,
  };
  return { root, repo, git, write, capture, cfg, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('repository scan excludes credentials, tracked ignores, caches and QA data while including ordinary untracked source', () => {
  const f = fixture();
  try {
    f.write('.gitignore', 'ignored/\ntracked-ignored.ts\n');
    f.write('source.ts', 'export const safe = true;\n');
    f.write('.github/workflows/build.yml', 'name: build\n');
    for (const file of ['.env', '.env.example', 'production.env', '.commit-defender/hook.json', '.gcr/local-memory.json', '.codex-work/auth.json', 'tracked-ignored.ts', 'ignored/private.ts', 'test-results/capture.json', 'node_modules/dependency.ts']) f.write(file, 'SYNTHETIC_PRIVATE_CANARY');
    f.git('add', '-f', '.env', 'tracked-ignored.ts');
    const excluded: SourceExclusion[] = [];
    const files = collectFiles(f.repo, f.repo, [], entry => excluded.push(entry));
    assert.deepEqual(files, ['.github/workflows/build.yml', '.gitignore', 'source.ts']);
    assert(excluded.some(entry => entry.path === '.env' && entry.reason === 'private-data'));
    assert(excluded.some(entry => entry.path === 'tracked-ignored.ts' && entry.reason === 'git-ignored'));
    assert(excluded.some(entry => entry.path === 'test-results' && entry.reason === 'generated'));
    assert.deepEqual(selectReviewInputs(f.repo, ['.env'], ['!**/.env']).files, []);
    assert(!getFileContents(f.repo, [...files, '.env', 'tracked-ignored.ts']).includes('SYNTHETIC_PRIVATE_CANARY'));
  } finally { f.cleanup(); }
});

test('nested ignore negation and user exclusions apply equally to explicit files and collection', () => {
  const f = fixture();
  try {
    f.write('src/.gitignore', '*.ts\n!allowed.ts\n');
    f.write('src/allowed.ts', 'allowed'); f.write('src/ignored.ts', 'ignored');
    f.write('src/custom.txt', 'custom');
    const selection = selectReviewInputs(f.repo, ['src/allowed.ts', 'src/ignored.ts', 'src/custom.txt'], ['**/custom.txt']);
    assert.deepEqual(selection.files, ['src/allowed.ts']);
    assert.deepEqual(new Set(selection.excluded.map(entry => entry.reason)), new Set(['git-ignored', 'user-excluded']));
    assert.deepEqual(collectFiles(path.join(f.repo, 'src'), f.repo, ['**/custom.txt']), ['src/.gitignore', 'src/allowed.ts']);
  } finally { f.cleanup(); }
});

test('file, directory and index symlinks cannot escape source selection', () => {
  const f = fixture();
  try {
    const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'private.ts'), 'OUTSIDE_CANARY');
    fs.symlinkSync(path.join(outside, 'private.ts'), path.join(f.repo, 'link.ts'));
    fs.symlinkSync(outside, path.join(f.repo, 'linked-dir'), 'dir');
    assert.deepEqual(collectFiles(f.repo, f.repo), []);
    assert.deepEqual(collectFiles(outside, f.repo), []);
    assert.equal(getFileContents(f.repo, ['../outside/private.ts', 'link.ts', 'linked-dir/private.ts']), '');
    f.git('add', 'link.ts');
    fs.unlinkSync(path.join(f.repo, 'link.ts')); f.write('link.ts', 'ordinary working tree replacement');
    assert.equal(getStagedSelection(f.repo).excluded[0]?.reason, 'symlink');
  } finally { f.cleanup(); }
});

test('read boundary rejects an ancestor replaced with a symlink after policy selection', (context) => {
  const f = fixture();
  try {
    f.write('inside/source.ts', 'safe');
    const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'source.ts'), 'OUTSIDE_CANARY');
    const open = fs.openSync;
    let changed = false;
    context.mock.method(fs, 'openSync', ((file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      if (!changed && String(file).endsWith('/inside/source.ts')) {
        changed = true;
        fs.renameSync(path.join(f.repo, 'inside'), path.join(f.repo, 'original'));
        fs.symlinkSync(outside, path.join(f.repo, 'inside'), 'dir');
      }
      return open(file, flags, mode);
    }) as typeof fs.openSync);
    assert.throws(() => readReviewFile(f.repo, 'inside/source.ts'), /path changed/);
    assert(changed);
  } finally { context.mock.restoreAll(); f.cleanup(); }
});

test('staged diff uses literal filenames and applies source policy to both sides of a rename', async () => {
  const f = fixture();
  try {
    f.write('.env', 'SYNTHETIC_AUTH_CANARY'); f.git('add', '-f', '.env'); f.git('commit', '-m', 'baseline');
    f.git('mv', '.env', 'renamed.ts');
    f.write(':(glob)*.ts', 'export const literal = true;');
    f.git('--literal-pathspecs', 'add', ':(glob)*.ts');
    const selection = getStagedSelection(f.repo);
    assert.deepEqual(selection.files, [':(glob)*.ts']);
    assert(selection.excluded.some(entry => entry.path === 'renamed.ts' && entry.reason === 'private-data'));
    const diff = await getStagedDiff(f.repo, ['renamed.ts', ':(glob)*.ts']);
    assert(diff.includes('literal = true'));
    assert(!diff.includes('SYNTHETIC_AUTH_CANARY'));
  } finally { f.cleanup(); }
});

test('single-file and staged Reviewer entrypoints refuse private-only inputs before calling a provider', async () => {
  const f = fixture();
  try {
    f.write('.env', 'SYNTHETIC_AUTH_CANARY'); f.git('add', '-f', '.env');
    const reviewer = new Reviewer(f.cfg);
    for (const result of [await reviewer.reviewFilesSeparately(f.repo, ['.env']), await reviewer.reviewDiff(f.repo, ['.env'])]) {
      assert(result.report.review.is_error);
      assert(result.report.source_exclusions?.some(entry => entry.path === '.env'));
      assert.deepEqual(result.report.staged_files, []);
    }
    assert((await reviewer.generateCommitMessage(f.repo)).is_error);
    assert(!fs.existsSync(f.capture));
  } finally { f.cleanup(); }
});

test('mixed on-demand review sends allowed source only and records exclusions', async () => {
  const f = fixture();
  try {
    f.write('.env', 'SYNTHETIC_AUTH_CANARY'); f.write('safe.ts', 'export const safe = true;');
    const result = await new Reviewer(f.cfg).reviewFilesSeparately(f.repo, ['safe.ts', '.env']);
    assert.deepEqual(result.report.staged_files, ['safe.ts']);
    assert.deepEqual(result.report.source_exclusions, [{ path: '.env', reason: 'private-data' }]);
    const sent = fs.readFileSync(f.capture, 'utf8');
    assert(sent.includes('export const safe = true'));
    assert(!sent.includes('SYNTHETIC_AUTH_CANARY'));
  } finally { f.cleanup(); }
});

test('skills are explicit safe files and cannot bypass ignores or symlink checks', () => {
  const f = fixture();
  try {
    f.write('.commit-defender/security/SKILL.md', 'Review authorization boundaries.');
    f.write('.commit-defender/hook.json', 'SYNTHETIC_AUTH_CANARY');
    fs.writeFileSync(path.join(f.root, 'outside.md'), 'OUTSIDE_CANARY');
    fs.mkdirSync(path.join(f.repo, '.commit-defender', 'escape'));
    fs.symlinkSync(path.join(f.root, 'outside.md'), path.join(f.repo, '.commit-defender', 'escape', 'SKILL.md'));
    const skills = loadSkills(f.repo);
    assert(skills.includes('Review authorization boundaries.'));
    assert(!skills.includes('CANARY'));
    assert.equal(loadSkills(f.repo, ['**/SKILL.md']), '');
    f.write('.gitignore', '.commit-defender/\n');
    assert.equal(loadSkills(f.repo), '');
  } finally { f.cleanup(); }
});

test('the actual hook bundle sends only permitted staged source and reports exclusions', () => {
  const f = fixture();
  try {
    f.write('.commit-defender/hook.json', JSON.stringify(f.cfg));
    f.write('.env', 'SYNTHETIC_AUTH_CANARY'); f.write('safe.ts', 'export const safe = true;');
    f.git('add', '-f', '.env', 'safe.ts');
    execFileSync(process.execPath, [path.resolve('out/hook-cli.js'), f.repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const sent = fs.readFileSync(f.capture, 'utf8');
    assert(sent.includes('export const safe = true'));
    assert(!sent.includes('SYNTHETIC_AUTH_CANARY'));
    assert(!sent.includes('codexPath'));
  } finally { f.cleanup(); }
});

test('ignore policy failures do not fall back to unrestricted file reads', () => {
  const f = fixture();
  try {
    f.write('safe.ts', 'export const safe = true;');
    fs.rmSync(path.join(f.repo, '.git'), { recursive: true });
    assert.throws(() => getFileContents(f.repo, ['safe.ts']), /ignore policy/);
  } finally { f.cleanup(); }
});
