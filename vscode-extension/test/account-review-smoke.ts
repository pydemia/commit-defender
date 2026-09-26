import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { prepareAccountReviewExecutor } from '../src/accountReviewExecutor.js';
async function main() {
  assert.equal(process.env.CD_ACCOUNT_SMOKE, '1', 'Explicit live-call opt-in required');
  const evidencePath = path.resolve('test-results/account-providers/' + (process.env.CD_SMOKE_EVIDENCE || process.env.CD_SMOKE_PROVIDER || 'live') + '.json');
  await mkdir(path.dirname(evidencePath), { recursive: true });
  const evidence: any = { maxRequests: 2, maximumDurationPerRequestMs: 120000, cases: [] };
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  for (const [provider, binary, model] of [
    ['claudecode', '/Users/a09255/.local/bin/claude', 'sonnet'],
    ['antigravity', '/Users/a09255/.local/bin/agy', 'gemini-3.8-flash-medium'],
  ]) {
    if (process.env.CD_SMOKE_PROVIDER && process.env.CD_SMOKE_PROVIDER !== provider) continue;
    const root = await mkdtemp(path.join(os.tmpdir(), 'cd-account-smoke-'));
    const observation = path.join(root, 'observation.json');
    const wrapper = path.join(root, 'observe-cli');
    const readId = randomUUID();
    const item: any = { provider, model, effort: 'medium', source: 'synthetic sum only', maximumRequests: 1, maximumDurationMs: 120000, status: 'preparing' };
    evidence.cases.push(item);
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    try {
      await writeFile(wrapper, `#!${process.execPath}\nconst {spawn}=require('node:child_process'); const fs=require('node:fs');\nconst child=spawn(${JSON.stringify(binary)},process.argv.slice(2),{stdio:['pipe','pipe','pipe']});\nlet out='',err='';child.stdout.on('data',c=>{out+=c;process.stdout.write(c)});child.stderr.on('data',c=>{err+=c;process.stderr.write(c)});process.stdin.pipe(child.stdin);child.on('exit',code=>{ if(!process.argv.includes('--help')&&!process.argv.includes('--version'))fs.writeFileSync(${JSON.stringify(observation)},JSON.stringify({code,stdout:out,stderr:err}));process.exitCode=code;});\n`, { mode: 0o700 });
      const executor = await prepareAccountReviewExecutor({ mode: 'standalone', profileId: 'synthetic', provider,
        model, reasoningEffort: 'medium', executablePath: wrapper, workspaceTrusted: true, durationMs: 120000, excludePatterns: [] });
      item.version = executor.descriptor.version;
      item.status = 'requesting';
      await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
      const started = Date.now();
      const result = await executor.review({ prompt: 'Review this captured addition function. Its contract requires addition. Identify whether subtraction is a defect. Return defect (boolean), summary (string), and readId copied exactly from the supplied fixed source read. Do not request tools.',
        responseSchema: { type: 'object', additionalProperties: false, properties: { defect: { type: 'boolean' }, summary: { type: 'string' }, readId: { type: 'string' } }, required: ['defect','summary','readId'] },
        source: { async execute(tool) { return JSON.stringify(tool === 'list_files' ? {files:[{path:'sum.ts',side:'source',lineCount:1}],nextOffset:null} : { status:'available', path:'sum.ts',side:'source',startLine:1,endLine:1,readId,content:'export function sum(left: number, right: number) { return left - right; }',truncated:false }); } },
        timeoutMs: 120000 });
      const raw = JSON.parse(result.raw);
      assert.equal(raw.defect,true); assert.equal(raw.readId,readId);
      item.durationMs = Date.now() - started; item.actualReviewCompleted = true; item.witnessMatched = true; item.defectRecognized = true;
      item.summary = raw.summary; item.status = 'passed';
    } catch (error: any) { item.status = 'failed'; item.code = error.code || error.name; }
    finally {
      try {
        const observed = JSON.parse(await readFile(observation,'utf8'));
        const file = evidencePath.replace(/\.json$/, '') + '-' + provider + '-observation.json';
        await writeFile(file, JSON.stringify(observed,null,2));
        item.observation = path.basename(file);
        try { const events = observed.stdout.trim().split('\n').map((line: string)=>JSON.parse(line)); item.events = events.map((e:any)=>({event:e.event,type:e.type,status:(e.result??e).status,tools:e.init?.tools})); } catch {}
        item.exitCode = observed.code;
      } catch {}
      await rm(root,{recursive:true,force:true}); await writeFile(evidencePath,JSON.stringify(evidence,null,2));
      console.log(JSON.stringify({provider,status:item.status,code:item.code,events:item.events}));
    }
  }
  if (evidence.cases.some((item:any)=>item.status!=='passed')) process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
