import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { captureLocalSource } from '@gcr/client-core';
import {
  BranchComparisonError, compareBranch, listBranchTargets,
} from '../src/branchComparison.js';
import { fixture } from './helpers/review-fixture.js';

test('branch changes use committed merge-base source and ignore uncommitted edits', async t => {
  const f = fixture(); t.after(f.cleanup);
  f.write('feature.ts', 'export const value = 1;\n');
  f.git('add', '.'); f.git('commit', '-m', 'base');
  f.git('switch', '-c', 'feature');
  f.write('feature.ts', 'export const value = 2;\n');
  f.git('add', '.'); f.git('commit', '-m', 'feature');
  f.write('feature.ts', 'export const value = 999;\n');
  const { targets } = await listBranchTargets(f.repo);
  const target = targets.find(item => item.name === 'main')!;
  const comparison = await compareBranch(f.repo, target, 'changes');
  const snapshot = captureLocalSource({
    cwd: f.repo, kind: 'commit-tree',
    sourceCommit: comparison.reviewSourceCommit,
    baseCommit: comparison.baseCommit,
    targetBranch: comparison.targetBranch,
  });
  try {
    assert.equal(comparison.sourceBranch, 'feature');
    assert.equal(comparison.baseCommit, target.commit);
    assert.equal(snapshot.selected.length, 1);
    assert.match(snapshot.diff, /value = 2/);
    assert(!snapshot.diff.includes('999'));
  } finally { snapshot.close(); }
});

test('merge impact reviews a virtual merged tree without changing HEAD or worktree', async t => {
  const f = fixture(); t.after(f.cleanup);
  f.write('feature.ts', 'export const value = 1;\n');
  f.write('consumer.ts', 'export const consumer = 1;\n');
  f.git('add', '.'); f.git('commit', '-m', 'base');
  f.git('switch', '-c', 'feature');
  f.write('feature.ts', 'export const value = 2;\n');
  f.git('add', '.'); f.git('commit', '-m', 'feature');
  const head = f.git('rev-parse', 'HEAD').trim();
  f.git('switch', 'main');
  f.write('consumer.ts', 'export const consumer = 2;\n');
  f.git('add', '.'); f.git('commit', '-m', 'target');
  f.git('switch', 'feature');
  const target = (await listBranchTargets(f.repo)).targets.find(item => item.name === 'main')!;
  const comparison = await compareBranch(f.repo, target, 'merge-impact');
  const snapshot = captureLocalSource({
    cwd: f.repo, kind: 'commit-tree',
    sourceCommit: comparison.reviewSourceCommit,
    baseCommit: comparison.baseCommit,
    targetBranch: comparison.targetBranch,
  });
  try {
    assert.equal(comparison.sourceCommit, head);
    assert.equal(comparison.baseCommit, target.commit);
    assert.equal(snapshot.readFile('consumer.ts').status, 'available');
    assert.match(snapshot.diff, /value = 2/);
    assert.equal(f.git('rev-parse', 'HEAD').trim(), head);
    assert.equal(f.git('status', '--porcelain').trim(), '');
    assert.equal(fs.readFileSync(path.join(f.repo, 'consumer.ts'), 'utf8'),
      'export const consumer = 1;\n');
  } finally { snapshot.close(); }
});

test('merge conflicts and moved target refs stop before model review', async t => {
  const f = fixture(); t.after(f.cleanup);
  f.write('feature.ts', 'export const value = 1;\n');
  f.git('add', '.'); f.git('commit', '-m', 'base');
  f.git('switch', '-c', 'feature');
  f.write('feature.ts', 'export const value = 2;\n');
  f.git('add', '.'); f.git('commit', '-m', 'feature');
  f.git('switch', 'main');
  f.write('feature.ts', 'export const value = 3;\n');
  f.git('add', '.'); f.git('commit', '-m', 'target');
  f.git('switch', 'feature');
  const target = (await listBranchTargets(f.repo)).targets.find(item => item.name === 'main')!;
  await assert.rejects(() => compareBranch(f.repo, target, 'merge-impact'),
    (error: unknown) => error instanceof BranchComparisonError &&
      error.code === 'merge-conflict');
  f.git('branch', '-f', 'main', 'HEAD');
  await assert.rejects(() => compareBranch(f.repo, target, 'changes'),
    (error: unknown) => error instanceof BranchComparisonError &&
      error.code === 'target-moved');
});

test('a branch without committed changes does not start a review', async t => {
  const f = fixture(); t.after(f.cleanup);
  f.write('source.ts', 'export const value = 1;\n');
  f.git('add', '.'); f.git('commit', '-m', 'base');
  f.git('switch', '-c', 'feature');
  f.write('source.ts', 'export const value = 2;\n');
  const target = (await listBranchTargets(f.repo)).targets.find(
    item => item.name === 'main',
  )!;
  await assert.rejects(() => compareBranch(f.repo, target, 'changes'),
    (error: unknown) => error instanceof BranchComparisonError &&
      error.code === 'no-changes');
});
