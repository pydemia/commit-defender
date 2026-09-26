import { runTests } from '@vscode/test-electron';
import { mkdtemp,mkdir,writeFile,rm,readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { defaultLocalDataDirectory,PlatformLocalKeyStore } from '@gcr/client-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(path.join(os.tmpdir(),'cd-account-host-'));
const profileId='cd-account-host-'+randomUUID();
const workspace=path.join(temp,'workspace');
const proofDir=path.join(root,'test-results/account-providers');
const proof=path.join(proofDir,process.env.CD_ACCOUNT_INSPECT === '1' ? 'host.json' : 'host-worker.json');
const ready=path.join(proofDir,'host-ready');
const binary=path.join(temp,'fixture-cli');
try {
 await mkdir(proofDir,{recursive:true}); await rm(proof,{force:true});await rm(ready,{force:true});
 await mkdir(workspace);const git=(...args)=>execFileSync('git',['-C',workspace,'-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args]);
 git('init','-b','main');await writeFile(path.join(workspace,'sum.ts'),'export const sum = 1;\n');git('add','.');git('commit','-m','base');
 await writeFile(path.join(workspace,'sum.ts'),'export const sum = 2;\n');await writeFile(path.join(workspace,'.env'),'DO_NOT_SEND=synthetic\n');git('add','.');
 await writeFile(binary,`#!${process.execPath}
const args=process.argv.slice(2);if(args.includes('--help')){console.error('--safe-mode --tools --strict-mcp-config --effort --agent --input-format --output-format --json-schema --disable-slash-commands');process.exit();}if(args.includes('--version')){console.log('fixture-1');process.exit();}let text='';process.stdin.on('data',x=>text+=x);process.stdin.on('end',()=>{if(text.includes('DO_NOT_SEND'))process.exit(21);let input=JSON.parse(text);if(input.event==='user')input=JSON.parse(input.message.content.slice(input.message.content.lastIndexOf('\\n')+1));const reads=input.fixedSourceReads;if(!reads.some(r=>r.source?.side==='source')||!reads.some(r=>r.source?.side==='base'))process.exit(22);const raw={summary:'Host fixture reviewed source and base',files:[{path:'sum.ts',side:'source',complete:true,summary:'Fixed captured context',readIds:reads.map(r=>r.readId)}],findings:[],questions:[]};if(args.includes('--safe-mode'))console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:raw}));else{console.log(JSON.stringify({event:'init',init:{agent:args[args.indexOf('--agent')+1],tools:['finish','view_file']}}));console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',response:JSON.stringify(raw)}}));}});
`,{mode:0o700});
 await mkdir(path.join(temp,'user-data/User'),{recursive:true});
 await writeFile(path.join(temp,'user-data/User/settings.json'),JSON.stringify({
 'commitDefender.aiProvider':'claudecode','commitDefender.model':'','commitDefender.reviewReasoningEffort':'medium',
 'commitDefender.claudeCodePath':binary,'commitDefender.antigravityPath':binary,'commitDefender.localProfile':profileId,
 'commitDefender.runOnStage':false,'commitDefender.preCommitHook':'disable','commitDefender.reviewMode':'standalone',
 'telemetry.telemetryLevel':'off','update.mode':'none','extensions.autoUpdate':false,
 'window.title':'Commit Defender Account Provider Verification',
 }));
 const configuration=path.join(temp,'configuration.json');await writeFile(configuration,JSON.stringify({workspace,binary,proof,ready,inspect:process.env.CD_ACCOUNT_INSPECT==='1'}));
 await runTests({vscodeExecutablePath:process.env.VSCODE_EXECUTABLE_PATH||'/Applications/Visual Studio Code.app/Contents/MacOS/Code',
 extensionDevelopmentPath:path.resolve(process.env.CD_TEST_EXTENSION_PATH||root),extensionTestsPath:path.join(root,'out-test/account-provider-host.cjs'),
 extensionTestsEnv:{CD_ACCOUNT_HOST_CONFIG:configuration,VSCODE_DEV:''},launchArgs:[workspace,'--user-data-dir',path.join(temp,'user-data'),'--extensions-dir',path.join(temp,'extensions'),'--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry']});
 console.log('Account Host verification finished: '+proof);
}finally{
 const dir=path.join(defaultLocalDataDirectory(),'profiles',profileId);
 for(const suffix of ['key-ref.json','local/key-ref.json'])try{const ref=JSON.parse(await readFile(path.join(dir,suffix),'utf8'));if(ref.profileId!==profileId)throw Error('Unexpected profile');await new PlatformLocalKeyStore().remove(`${profileId}.${ref.id}`);}catch(error){if(error.code!=='ENOENT')throw error;}
 await rm(dir,{recursive:true,force:true});await rm(temp,{recursive:true,force:true});
}
