import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir,mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';
import { defaultLocalDataDirectory,PlatformLocalKeyStore } from '@gcr/client-core';

const extensionRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(path.join(os.tmpdir(),'cd-performance-host-'));
const profiles={baseline:'cd-perf-'+randomUUID(),upgraded:'cd-perf-'+randomUUID()};
const workspace=path.join(temp,'workspace');
const onlyUpgraded=process.env.CD_PERFORMANCE_ONLY_UPGRADED==='1';
const evidence=path.join(extensionRoot,`test-results/performance-2026-09-28/live-host${onlyUpgraded?'-related':''}.json`);
const baselineWorker=process.env.CD_PERFORMANCE_BASELINE_WORKER;
assert(baselineWorker&&path.isAbsolute(baselineWorker));
try {
  await mkdir(workspace);
  const git=(...args)=>execFileSync('git',['-C',workspace,'-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',...args],{stdio:'ignore'});
  git('init','-b','main');git('config','user.name','Performance Fixture');git('config','user.email','fixture@example.invalid');
  // A realistic-length utility module makes source/base pagination visible.
  const helpers=Array.from({length:55},(_,i)=>`export function isAtLeast${i}(value: number): boolean {\n  if (!Number.isFinite(value)) return false;\n  return value >= ${i};\n}\n`).join('\n');
  const body=(initial)=>`/** Empty collections are valid: total([]) must be zero. */\nexport function total(values: number[]): number {\n  return values.reduce((a, b) => a + b${initial?', 0':''});\n}\n\n${helpers}`;
  await writeFile(path.join(workspace,'totals.ts'),body(true));
  await writeFile(path.join(workspace,'invoice.ts'),'import { total } from "./totals";\n/** A customer with no invoices receives a zero total. */\nexport const invoiceTotal = (invoices: {amount:number}[]) => total(invoices.map(x=>x.amount));\n');
  await writeFile(path.join(workspace,'totals.test.ts'),'import { total } from "./totals";\nimport { strict as assert } from "node:assert";\nassert.equal(total([]), 0);\nassert.equal(total([1,2]), 3);\n');
  git('add','.');git('commit','-m','Synthetic performance baseline');
  await writeFile(path.join(workspace,'totals.ts'),body(false));
  await writeFile(path.join(workspace,'.env'),'DO_NOT_SEND_SYNTHETIC_SECRET=fixture\n');git('add','.');
  await mkdir(path.join(temp,'user-data/User'),{recursive:true});
  await writeFile(path.join(temp,'user-data/User/settings.json'),JSON.stringify({
    'commitDefender.aiProvider':'codex','commitDefender.codexPath':'/opt/homebrew/bin/codex',
    'commitDefender.model':'gpt-5.6-luna','commitDefender.reviewReasoningEffort':'medium',
    'commitDefender.reviewMode':'standalone','commitDefender.localProfile':profiles.upgraded,
    'commitDefender.preCommitHook':'disable','commitDefender.runOnStage':false,'commitDefender.runOnSave':false,
    'telemetry.telemetryLevel':'off','update.mode':'none','extensions.autoUpdate':false,
  }));
  const config=path.join(temp,'config.json');
  await writeFile(config,JSON.stringify({workspace,profiles,baselineWorker,evidence,onlyUpgraded}));
  await runTests({vscodeExecutablePath:'/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    extensionDevelopmentPath:process.env.CD_TEST_EXTENSION_PATH||extensionRoot,
    extensionTestsPath:path.join(extensionRoot,'out-test/performance-host.cjs'),
    extensionTestsEnv:{CD_PERFORMANCE_CONFIG:config},launchArgs:[workspace,'--user-data-dir',path.join(temp,'user-data'),
      '--extensions-dir',path.join(temp,'extensions'),'--disable-extensions','--disable-workspace-trust',
      '--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry']});
  console.log('Performance evidence: '+evidence);
} finally {
  for(const profileId of Object.values(profiles)){
    const dir=path.join(defaultLocalDataDirectory(),'profiles',profileId);
    for(const suffix of ['key-ref.json','local/key-ref.json'])try{
      const ref=JSON.parse(await readFile(path.join(dir,suffix),'utf8'));assert.equal(ref.profileId,profileId);
      await new PlatformLocalKeyStore().remove(`${profileId}.${ref.id}`);
    }catch(error){if(error.code!=='ENOENT')throw error;}
    await rm(dir,{recursive:true,force:true});
  }
  await rm(temp,{recursive:true,force:true});
}
