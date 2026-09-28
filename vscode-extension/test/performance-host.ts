import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { prepareStandaloneWorker } from '../src/standaloneWorkerClient.js';
import { getStandaloneReviewSettings } from '../src/config.js';
import { clientReviewReport } from '@gcr/client-contract';

/** Deliberately separate from npm test: two real account review attempts on synthetic source. */
export async function run() {
  const cfg = JSON.parse(fs.readFileSync(process.env.CD_PERFORMANCE_CONFIG!, 'utf8'));
  const extension = vscode.extensions.getExtension('pydemia.commit-defender')!;
  await extension.activate();
  const settingsBefore = JSON.stringify(vscode.workspace.getConfiguration('commitDefender'));
  const selected = getStandaloneReviewSettings(1, cfg.workspace);
  assert.equal(selected.provider, 'codex');
  assert.equal(selected.model, 'gpt-5.6-luna');
  assert.equal(selected.reasoningEffort, 'medium');
  const proof: any = { status:'running', realExtensionHost:true, actualAccount:true,
    fixture:'synthetic TypeScript module, fixed callers and empty-input contract test',
    expected:'Report empty-input reduce failure; read full selected source/base, preserve exclusion of .env',
    model:selected.model, effort:selected.reasoningEffort,
    limits:{reviewAttempts:cfg.onlyUpgraded?1:2,perReviewMs:240000,noAutomaticRetry:true},
    version:extension.packageJSON.version, results:[] };
  fs.writeFileSync(cfg.evidence, JSON.stringify(proof,null,2));
  for (const [name,worker] of [['baseline',cfg.baselineWorker],['upgraded',path.join(extension.extensionPath,'out/standalone-review-worker.js')]]) {
    if (cfg.onlyUpgraded && name === 'baseline') continue;
    const start=performance.now(); const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort('timeout'),240000);
    let job: Awaited<ReturnType<typeof prepareStandaloneWorker>>|undefined;
    try {
      job=await prepareStandaloneWorker(worker,{repoRoot:cfg.workspace,files:['totals.ts'],scope:'staged'},
        {...selected,mode:'standalone',profileId:cfg.profiles[name],durationMs:240000},controller.signal);
      const preparedMs=Math.round(performance.now()-start);
      const result=await job.run(controller.signal);
      const report=clientReviewReport(result.report.gcr!.report);
      const entry={name,wallMs:Math.round(performance.now()-start),preparedMs,reviewMs:report.durationMs,
        status:report.status,problems:report.problems.map(p=>p.code), findings:report.findings.map(f=>({title:f.title,problem:f.problem,anchor:f.anchor,severity:f.severity})),
        sourceReads:report.evidence.filter(e=>e.kind==='source-read').length,
        selectedSourceReads:[...new Set(report.files.flatMap(f=>report.evidence.filter(e=>e.kind==='source-read'&&e.location.path===f.source.path).map(e=>e.id)))].length,
        selectedFiles:report.files.map(f=>({path:f.source.path,status:f.status})),excludedSensitive:report.excluded.some(e=>e.path==='.env'),
        ...(result.performance?{timing:result.performance}:{}),sourceHash:report.identity.source.hash};
      proof.results.push(entry);
    } catch(error) {
      proof.results.push({name,wallMs:Math.round(performance.now()-start),status:'failed',code:(error as any)?.code??'host-error'});
    } finally {clearTimeout(timer);await job?.dispose?.();}
    fs.writeFileSync(cfg.evidence, JSON.stringify(proof,null,2));
  }
  assert.equal(JSON.stringify(vscode.workspace.getConfiguration('commitDefender')),settingsBefore);
  proof.settingsUnchanged=true;
  const latest=proof.results.find((r:any)=>r.name==='upgraded');
  proof.status=latest?.status==='completed'&&latest.findings.some((f:any)=>/empty|reduce|initial|빈|초기/i.test(f.title+' '+f.problem))?'passed':'not-passed';
  fs.writeFileSync(cfg.evidence, JSON.stringify(proof,null,2));
  assert.equal(proof.status,'passed','Live optimized review must complete and find the known defect.');
}
