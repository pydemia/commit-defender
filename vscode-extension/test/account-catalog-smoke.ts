import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { loadAccountModels, type SetupAccountProvider } from '../src/accountModelCatalog.js';
async function main() {
  const checks = [];
  for (const provider of ['codex', 'claudecode', 'antigravity'] as SetupAccountProvider[]) {
    const executable = process.env[`CD_${provider.toUpperCase()}_PATH`];
    if (!executable) throw Error(`Set CD_${provider.toUpperCase()}_PATH to the existing absolute CLI path.`);
    const started = Date.now();
    try {
      const models = await loadAccountModels(provider, executable, { workerPath: path.resolve('out/account-catalog-worker.js') });
      checks.push({ provider, status: 'passed', durationMs: Date.now() - started,
        models: models.map(m => ({ id: m.id, label: m.label, efforts: m.efforts, variants: m.variants })) });
    } catch (error) { checks.push({ provider, status: 'failed', durationMs: Date.now() - started, error: (error as any).code ?? 'unknown' }); }
  }
  const result = { checks, realModelGenerationCalls: 0, credentialsPrinted: false };
  writeFileSync('test-results/account-catalog-smoke.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (checks.some(check => check.status !== 'passed')) process.exitCode = 1;
}
void main();
