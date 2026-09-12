import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as vscode from 'vscode';

/** The UI operator clicks Raw JSON for each state; VS Code's actual document is the evidence. */
export async function run(): Promise<void> {
  const control = process.env.CD_OUTCOME_CONTROL!;
  const workspace = process.env.CD_TEST_WORKSPACE!;
  assert(control && workspace);
  const extension = vscode.extensions.getExtension('pydemia.commit-defender');
  assert(extension);
  await extension.activate();
  const reports = new Map<string, any>();
  let phase = '';
  const listener = vscode.workspace.onDidOpenTextDocument((document) => {
    if (document.languageId !== 'json') return;
    try {
      const report = JSON.parse(document.getText());
      if (report.schema_version === 1 && report.review)
        reports.set(phase, report);
    } catch {
      /* unrelated editor document */
    }
  });
  const waitFor = async (predicate: () => boolean, label: string) => {
    const deadline = Date.now() + 240_000;
    while (!predicate()) {
      if (Date.now() > deadline)
        throw new Error(`Timed out waiting for ${label}`);
      await delay(50);
    }
  };
  const write = (file: string, value: unknown) => {
    const target = path.join(control, file);
    fs.writeFileSync(target + '.tmp', JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(target + '.tmp', target);
  };
  try {
    for (phase of ['completed', 'failed', 'partial', 'cancelled']) {
      write('provider.json', { phase });
      const running = vscode.commands.executeCommand(
        'commitDefender.analyzeRepository',
      );
      if (phase === 'cancelled') {
        await waitFor(
          () => fs.existsSync(path.join(control, 'waiting')),
          'provider cancellation point',
        );
        await vscode.commands.executeCommand('commitDefender.cancel');
      }
      await running;
      write('stage.json', {
        phase,
        ready: true,
        instruction:
          'Inspect summary/status, click Raw JSON, then create ack-' + phase,
      });
      await waitFor(() => reports.has(phase), 'Raw JSON document for ' + phase);
      const report = reports.get(phase);
      assert.equal(
        report.review.status,
        phase,
        'Raw JSON must match the current panel',
      );
      assert.equal(report.staged_files.length, 2);
      assert.equal(report.review.is_error, phase === 'failed');
      assert.equal(
        report.review.file_comments.length,
        phase === 'failed' ? 0 : 1,
      );
      const expected =
        phase === 'completed'
          ? ['completed', 'completed']
          : phase === 'failed'
            ? ['failed', 'failed']
            : phase === 'partial'
              ? ['completed', 'failed']
              : ['completed', 'cancelled'];
      assert.deepEqual(
        report.review.per_file_summaries.map((entry: any) => entry.status),
        expected,
      );
      const diagnostics = vscode.languages
        .getDiagnostics()
        .filter(([uri]) => uri.fsPath.startsWith(workspace))
        .flatMap(([, rows]) => rows);
      assert.equal(
        diagnostics.length,
        phase === 'failed' ? 0 : 1,
        'failed review must clear previous findings',
      );
      write('report-' + phase + '.json', report);
      await waitFor(
        () => fs.existsSync(path.join(control, 'ack-' + phase)),
        'visual acknowledgement for ' + phase,
      );
    }
    write('evidence.json', {
      status: 'passed',
      vscode: vscode.version,
      node: process.versions.node,
      modelCalled: false,
      states: [...reports.keys()],
      checks: [
        'current Raw JSON per state',
        'per-file outcomes',
        'retained partial/cancelled findings',
        'failed run clears previous diagnostics',
      ],
    });
  } finally {
    listener.dispose();
  }
}
