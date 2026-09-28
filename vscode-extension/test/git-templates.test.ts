import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  commitMessageParts, commitTemplateValues, parseCommitMessage, readGitTemplateValues,
  renderGitTemplate, templateVariables, unavailableRepositoryVariables, validateGitTemplate,
} from '../src/gitTemplates.js';

function repository(branch = 'issue/481-commit-template') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-commit-template-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  git('init', '-b', branch); git('config', 'user.name', 'Template Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(root, 'source.ts'), 'export const value = 1;\n');
  git('add', '.'); git('commit', '-m', 'fixture');
  return { root, git, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('commit formats accept dollar variables, braced names and an escaped literal dollar', () => {
  const template = '[$type] ${title}\n\n$body\n\nIssue #$issueId; cost $$5';
  assert.deepEqual(templateVariables(template), ['type', 'title', 'body', 'issueId']);
  assert.equal(validateGitTemplate(template), undefined);
  assert.equal(renderGitTemplate(template, {
    type: 'Fix', title: 'Preserve the selected format', body: '- Render fields locally', issueId: '481',
  }), '[Fix] Preserve the selected format\n\n- Render fields locally\n\nIssue #481; cost $5');
  assert.match(validateGitTemplate('$unknown $title')!, /Unknown variable/);
  assert.match(validateGitTemplate('$type')!, /\$title/);
  assert.match(validateGitTemplate('$title\u0000')!, /control/);
});

test('model fields and legacy commit_message responses render through the same template', () => {
  assert.deepEqual(parseCommitMessage('[Fix] Keep drafts\n\n- Preserve concurrent input'), {
    type: 'Fix', scope: '', title: 'Keep drafts', body: '- Preserve concurrent input',
  });
  assert.deepEqual(commitMessageParts({ commit_message: '[Improve] Keep useful detail\n\n- Explain what and why' }), {
    type: 'Improve', scope: '', title: 'Keep useful detail', body: '- Explain what and why',
  });
  assert.deepEqual(commitMessageParts({ type: 'Fix', scope: 'scm', title: 'Use templates', body: 'Keep details', commit_message: '' }), {
    type: 'Fix', scope: 'scm', title: 'Use templates', body: 'Keep details',
  });
});

test('repository variables are local, stable and checked before a model request', t => {
  const f = repository(); t.after(f.cleanup);
  const values = readGitTemplateValues(f.root);
  assert.equal(values.branch, 'issue/481-commit-template');
  assert.equal(values.branchId, '481'); assert.equal(values.issueId, '481');
  assert.match(values.commitId!, /^[0-9a-f]{12}$/); assert.match(values.date!, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(unavailableRepositoryVariables('$title refs PR $prId at $commitId', f.root), ['prId']);
  assert.deepEqual(unavailableRepositoryVariables('$title refs issue $issueId at $commitId', f.root), []);
  const rendered = renderGitTemplate('$type($scope): $title [$branch@$commitId]', commitTemplateValues(f.root, {
    type: 'Fix', scope: 'scm', title: 'Keep useful detail', body: '',
  }));
  assert.match(rendered, /^Fix\(scm\): Keep useful detail \[issue\/481-commit-template@[0-9a-f]{12}]$/);
});

test('PR variables recognize GitHub-style pr/id branch names', t => {
  const f = repository('pr/1099-fix-review'); t.after(f.cleanup);
  const values = readGitTemplateValues(f.root);
  assert.equal(values.branchId, '1099'); assert.equal(values.prId, '1099');
  assert.deepEqual(unavailableRepositoryVariables('$title for PR #$prId', f.root), []);
});
