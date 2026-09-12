import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ResolvedConfig } from '../../src/config.js';

export function fixture() {
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
  return { root, repo, git, write, capture, executable, cfg, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

