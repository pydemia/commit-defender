import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { getStandaloneReviewSettings } from '../src/config.js';
import { prepareStandaloneWorker } from '../src/standaloneWorkerClient.js';
export async function run() {
  const ext = vscode.extensions.getExtension('pydemia.commit-defender')!;
  await ext.activate();
  const input=JSON.parse(fs.readFileSync(process.env.CD_ACCOUNT_HOST_CONFIG!,'utf8'));
  const proof: any={realExtensionHost:true,modelResponses:'fixture',actualModelCalls:0,version:ext.packageJSON.version,vscodeVersion:vscode.version,results:[]};
  assert(!ext.packageJSON.contributes.commands.some((c:any)=>c.command==='commitDefender.signInGeminiCli'));
  assert(!ext.packageJSON.contributes.configuration.properties['commitDefender.aiProvider'].enum.includes('geminicli'));
  const worker=path.join(ext.extensionPath,'out','standalone-review-worker.js');
  const review=async(provider:string)=>{
    const settings=getStandaloneReviewSettings(1,input.workspace);
    assert.equal(settings.provider,provider); assert.equal(settings.model,'');
    assert.equal(settings.executablePath,input.binary);
    const abort=new AbortController();
    const job=await prepareStandaloneWorker(worker,{repoRoot:input.workspace,files:['sum.ts'],scope:'staged'},settings,abort.signal);
    try {
      const result=await job.run(abort.signal);
      assert.equal(result.report.gcr?.report.status,'completed');
      assert.equal(result.report.gcr?.report.identity.executor.id,provider+'-account');
      assert.equal(result.report.gcr?.report.identity.executor.model,'cli-default');
      proof.results.push({provider,status:result.report.gcr?.report.status,identity:result.report.gcr?.report.identity});
    } finally {await job.dispose?.();}
  };
  await review('claudecode');
  if (input.inspect) {
    fs.writeFileSync(input.ready,JSON.stringify({stage:'account-picker',version:proof.version}));
    await vscode.commands.executeCommand('commitDefender.selectAccountProviderAndModel');
  } else {
    await vscode.workspace.getConfiguration('commitDefender').update('aiProvider','antigravity',vscode.ConfigurationTarget.Global);
  }
  assert.equal(vscode.workspace.getConfiguration('commitDefender').get('aiProvider'),'antigravity');
  assert.equal(getStandaloneReviewSettings(1,input.workspace).reasoningEffort,'medium');
  proof.selection={provider:'antigravity',model:'CLI default',reasoning:'medium',nativeQuickPick:!!input.inspect,screenVerified:!!input.inspect};
  await review('antigravity');
  assert.equal(vscode.workspace.getConfiguration('commitDefender').get('runOnStage'),false);
  proof.status='passed';
  fs.writeFileSync(input.proof,JSON.stringify(proof,null,2));
}
