import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Reviewer } from '../src/ai/reviewer.js';
import { buildSystemPrompt } from '../src/ai/prompt.js';
import { captureStagedSnapshot } from '../src/gitSnapshot.js';
import { applyMarkers } from '../src/skipMarkers.js';
import type { FileComment } from '../src/types.js';
import { fixture } from './helpers/review-fixture.js';

const finding = (file = 'source.py', line = 1): FileComment => ({
  file, line, comment: 'Deletion breaks the caller.', category: 'correctness', priority: 'P3',
});
const response = (file = 'source.py', line = 1) => ({
  summary: 'Snapshot finding.', blocking: false, grade: 'insufficient', file_comments: [finding(file, line)],
});
function provider(f: ReturnType<typeof fixture>, raw: object, before = '', dynamicFile = false) {
  fs.writeFileSync(f.executable, `#!/usr/bin/env node
const fs = require('node:fs');
const cp = require('node:child_process');
let text = ''; process.stdin.on('data', chunk => text += chunk);
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(f.capture)}, JSON.stringify(text) + '\\n');
  ${before}
  const response = ${JSON.stringify(raw)};
  ${dynamicFile ? "if (text.includes('second.py')) response.file_comments[0].file = 'second.py';" : ''}
  process.stdout.write(JSON.stringify(response));
});
`);
}
function preservedIndex(repo: string): () => void {
  const file = path.resolve(repo, execFileSync('git', ['-C', repo, 'rev-parse', '--git-path', 'index'], { encoding: 'utf8' }).trim());
  const bytes = fs.readFileSync(file);
  const modified = fs.statSync(file).mtimeMs;
  return () => {
    assert.deepEqual(fs.readFileSync(file), bytes, 'user index bytes changed');
    assert.equal(fs.statSync(file).mtimeMs, modified, 'user index was rewritten');
  };
}

test('partial stage freezes diff and markers even if both HEAD and index change during provider execution', async () => {
  const f = fixture();
  try {
    f.write('source.py', 'value = 0\n'); f.git('add', '.'); f.git('commit', '-m', 'base');
    f.write('source.py', 'value = 1\n'); f.git('add', 'source.py');
    const before = preservedIndex(f.repo);
    const captured = captureStagedSnapshot(f.repo);
    assert.equal(captured.readSelected('source.py'), 'value = 1\n');
    assert(captured.diff().includes('+value = 1'));
    before();
    f.write('source.py', 'value = 1 # CD:skip: working tree only\n');
    provider(f, response(), `fs.writeFileSync(${JSON.stringify(path.join(f.repo, 'source.py'))}, 'value = 2 # CD:skip: later index\\n'); cp.execFileSync('git', ['-C', ${JSON.stringify(f.repo)}, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'add', 'source.py']); cp.execFileSync('git', ['-C', ${JSON.stringify(f.repo)}, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'changed during review']);`);
    const result = await new Reviewer(f.cfg).reviewDiff(f.repo, ['source.py']);
    assert(!result.report.review.is_error, result.report.review.summary);
    assert.deepEqual(result.report.review.file_comments, [finding()]);
    assert.equal(result.report.source_snapshot?.kind, 'index');
    assert.deepEqual(result.report.source_snapshot, {
      kind: 'index', base_commit: captured.baseCommit, base_tree: captured.baseTree, source_tree: captured.sourceTree,
    });
    const sent = fs.readFileSync(f.capture, 'utf8');
    assert(sent.includes('+value = 1'));
    assert(!sent.includes('working tree only'));
    assert(!sent.includes('later index'));
    assert.equal(captured.readSelected('source.py'), 'value = 1\n');
  } finally { f.cleanup(); }
});

test('TODO, type-ignore and marker text in strings do not suppress review; explicit captured comments do', () => {
  const lines = [
    'value = missing # TODO',
    'value = missing # type: ignore',
    'value = missing # CD:skip: explicit waiver',
    'text = "# CD:skip"',
    'text = """',
    '# CD:skip',
    '"""',
    'value = missing # CD:skipper',
  ];
  const comments = lines.map((_, index) => finding('source.py', index + 1));
  assert.deepEqual(applyMarkers(comments, new Map([['source.py', lines.join('\n')]])).map(c => c.line), [1, 2, 4, 5, 6, 7, 8]);
  assert.deepEqual(applyMarkers([finding('source.ts')], new Map([['source.ts', 'const x = missing; // CD:skip: explicit waiver']])).length, 0);
  const system = buildSystemPrompt({ mode: 'diff', severity: 'moderate', richness: 'moderate', locale: 'en', skillsText: '' });
  assert(system.includes('TODO and type-checker suppression comments do not exempt'));
  assert(!system.includes('known unfinished work; skip this line'));
});

test('staged explicit suppression is not removed by an un-staged edit', async () => {
  const f = fixture();
  try {
    f.write('source.py', 'value = 1 # CD:skip: acknowledged\n'); f.git('add', '.');
    f.write('source.py', 'value = 1\n');
    provider(f, response());
    const result = await new Reviewer(f.cfg).reviewDiff(f.repo, ['source.py']);
    assert(!result.report.review.is_error, result.report.review.summary);
    assert.deepEqual(result.report.review.file_comments, []);
  } finally { f.cleanup(); }
});

test('on-demand source and marker decisions freeze all files before progress and provider callbacks', async () => {
  const f = fixture();
  try {
    f.write('source.py', 'value = 1\n');
    f.write('second.py', 'other = 2\n');
    provider(f, response(), '', true);
    const result = await new Reviewer(f.cfg).reviewFilesSeparately(f.repo, ['source.py', 'second.py'], undefined, () => {
      f.write('source.py', 'value = 5 # CD:skip: later\n');
      f.write('second.py', 'other = 6 # CD:skip: later\n');
    });
    assert.deepEqual(result.report.review.file_comments.map(c => c.file), ['source.py', 'second.py']);
    const sent = fs.readFileSync(f.capture, 'utf8');
    assert(sent.includes('value = 1')); assert(sent.includes('other = 2')); assert(!sent.includes('CD:skip: later'));
    assert.deepEqual(result.report.source_snapshot, { kind: 'working-tree', content_sha256: {
      'source.py': createHash('sha256').update('value = 1\n').digest('hex'),
      'second.py': createHash('sha256').update('other = 2\n').digest('hex'),
    } });
  } finally { f.cleanup(); }
});

test('deletion and rename retain old source and unchanged broken consumers in the fixed source view', () => {
  const f = fixture();
  try {
    f.write('api.py', 'def load():\n    return 1\n');
    f.write('caller.py', 'from api import load\nassert load() == 1\n');
    f.write('old.ts', 'export const moved = 1;\n');
    f.git('add', '.'); f.git('commit', '-m', 'base');
    execFileSync('python3', ['-B', 'caller.py'], { cwd: f.repo, stdio: 'pipe' });
    f.git('rm', 'api.py'); f.git('mv', 'old.ts', 'new.ts');
    const before = preservedIndex(f.repo);
    const captured = captureStagedSnapshot(f.repo);
    assert.deepEqual(captured.files.sort(), ['api.py', 'new.ts']);
    assert.equal(captured.readSelected('api.py'), 'def load():\n    return 1\n');
    assert.equal(captured.readSource('api.py'), undefined);
    assert.equal(captured.readSource('caller.py'), 'from api import load\nassert load() == 1\n');
    const diff = captured.diff();
    assert(diff.includes('deleted file mode')); assert(diff.includes('-def load():'));
    assert(diff.includes('rename from old.ts')); assert(diff.includes('rename to new.ts'));
    assert.throws(() => execFileSync('python3', ['-B', 'caller.py'], { cwd: f.repo, stdio: 'pipe' }), /No module named 'api'/);
    before();
  } finally { f.cleanup(); }
});

test('file-to-directory changes cannot expand a selected path to include a private child', () => {
  const f = fixture();
  try {
    f.write('container.ts', 'export const old = 1;'); f.git('add', '.'); f.git('commit', '-m', 'base');
    f.git('rm', 'container.ts');
    f.write('container.ts/.env', 'SYNTHETIC_PRIVATE_CANARY'); f.git('add', '-f', 'container.ts/.env');
    const captured = captureStagedSnapshot(f.repo);
    assert.deepEqual(captured.files, ['container.ts']);
    const diff = captured.diff();
    assert(diff.includes('-export const old = 1;'));
    assert(!diff.includes('SYNTHETIC_PRIVATE_CANARY'));
    assert(!diff.includes('container.ts/.env'));
  } finally { f.cleanup(); }
});

test('initial commit and intent-to-add use the actual index, without writing the user index', () => {
  const f = fixture();
  try {
    f.write('staged.ts', 'export const staged = 1;'); f.git('add', 'staged.ts');
    f.write('intent.ts', 'export const notStaged = 1;'); f.git('add', '-N', 'intent.ts');
    const before = preservedIndex(f.repo);
    const captured = captureStagedSnapshot(f.repo);
    assert.equal(captured.baseCommit, null);
    assert.deepEqual(captured.files, ['staged.ts']);
    assert(captured.diff().includes('new file mode'));
    assert(!captured.diff().includes('intent.ts'));
    before();
  } finally { f.cleanup(); }
});

for (const indexMode of ['version4', 'split']) {
  test(`${indexMode} index can be captured without changing its bytes or mtime`, () => {
    const f = fixture();
    try {
      f.write('source.py', 'value = 0\n'); f.git('add', '.'); f.git('commit', '-m', 'base');
      f.write('source.py', 'value = 1\n'); f.git('add', '.');
      f.git('update-index', indexMode === 'split' ? '--split-index' : '--index-version=4');
      const before = preservedIndex(f.repo);
      const captured = captureStagedSnapshot(f.repo);
      assert.equal(captured.readSelected('source.py'), 'value = 1\n');
      assert(captured.diff().includes('+value = 1'));
      before();
    } finally { f.cleanup(); }
  });
}

test('sparse indexes retain fixed related source without materializing it in the working tree', () => {
  const f = fixture();
  try {
    f.write('inside/source.py', 'value = 0\n');
    f.write('outside/caller.py', 'from inside.source import value\n');
    f.git('add', '.'); f.git('commit', '-m', 'base');
    f.git('sparse-checkout', 'init', '--cone', '--sparse-index');
    f.git('sparse-checkout', 'set', 'inside');
    f.write('inside/source.py', 'value = 1\n'); f.git('add', 'inside/source.py');
    const before = preservedIndex(f.repo);
    const captured = captureStagedSnapshot(f.repo);
    assert(captured.diff().includes('+value = 1'));
    assert.equal(captured.readSource('outside/caller.py'), 'from inside.source import value\n');
    assert(!fs.existsSync(path.join(f.repo, 'outside/caller.py')));
    before();
  } finally { f.cleanup(); }
});

test('SHA-256 repositories compute their own empty tree for an initial commit', () => {
  const f = fixture();
  try {
    fs.rmSync(path.join(f.repo, '.git'), { recursive: true });
    f.git('init', '--object-format=sha256', '-b', 'main');
    f.write('source.py', 'value = 1\n'); f.git('add', '.');
    const before = preservedIndex(f.repo);
    const captured = captureStagedSnapshot(f.repo);
    assert.equal(captured.baseTree.length, 64);
    assert.equal(captured.sourceTree.length, 64);
    assert(captured.diff().includes('+value = 1'));
    before();
  } finally { f.cleanup(); }
});

test('alternate and linked-worktree indexes stay independent', () => {
  const f = fixture();
  const savedIndex = process.env.GIT_INDEX_FILE;
  try {
    f.write('source.py', 'value = 0\n'); f.git('add', '.'); f.git('commit', '-m', 'base');
    const other = path.join(f.root, 'linked'); f.git('worktree', 'add', '-b', 'linked', other);
    fs.writeFileSync(path.join(other, 'source.py'), 'value = 3\n');
    execFileSync('git', ['-C', other, 'add', '.']);
    const before = preservedIndex(f.repo);
    const linkedBefore = preservedIndex(other);
    assert.equal(captureStagedSnapshot(other).readSelected('source.py'), 'value = 3\n');
    assert.deepEqual(captureStagedSnapshot(f.repo).files, []);
    const alternate = path.join(f.root, 'alternate-index');
    fs.copyFileSync(path.join(f.repo, '.git', 'index'), alternate);
    process.env.GIT_INDEX_FILE = alternate;
    f.write('source.py', 'value = 7\n'); f.git('add', '.');
    const alternateBefore = preservedIndex(f.repo);
    assert.equal(captureStagedSnapshot(f.repo).readSelected('source.py'), 'value = 7\n');
    alternateBefore();
    if (savedIndex === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = savedIndex;
    before(); linkedBefore();
  } finally {
    if (savedIndex === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = savedIndex;
    f.cleanup();
  }
});

test('unmerged and missing-object indexes fail instead of falling back to working-tree source', async () => {
  const f = fixture();
  try {
    f.write('source.py', 'value = 0\n'); f.git('add', '.'); f.git('commit', '-m', 'base');
    f.git('checkout', '-b', 'other'); f.write('source.py', 'value = 2\n'); f.git('commit', '-am', 'other');
    f.git('checkout', 'main'); f.write('source.py', 'value = 1\n'); f.git('commit', '-am', 'main');
    assert.throws(() => f.git('merge', 'other'));
    const before = preservedIndex(f.repo);
    assert.throws(() => captureStagedSnapshot(f.repo));
    assert((await new Reviewer(f.cfg).reviewDiff(f.repo, ['source.py'])).report.review.is_error);
    before();
    assert(!fs.existsSync(f.capture));
    f.git('merge', '--abort');
    f.git('update-index', '--cacheinfo', '100644', '1'.repeat(40), 'source.py');
    assert.throws(() => captureStagedSnapshot(f.repo));
  } finally { f.cleanup(); }
});

test('actual hook uses captured staged markers even if its provider changes the working tree', () => {
  const f = fixture();
  try {
    f.write('source.py', 'value = 1\n'); f.git('add', '.');
    f.write('.commit-defender/hook.json', JSON.stringify(f.cfg));
    provider(f, response(), `fs.writeFileSync(${JSON.stringify(path.join(f.repo, 'source.py'))}, 'value = 1 # CD:skip: later\\n');`);
    try {
      execFileSync(process.execPath, [path.resolve('out/hook-cli.js'), f.repo], { encoding: 'utf8', stdio: 'pipe' });
      assert.fail('P3 should preserve legacy hook blocking');
    } catch (error) {
      assert.equal((error as { status: number }).status, 1);
      assert(String((error as { stderr: string }).stderr).includes('BLOCKED'));
      assert(String((error as { stderr: string }).stderr).includes('Deletion breaks the caller.'));
    }
  } finally { f.cleanup(); }
});
