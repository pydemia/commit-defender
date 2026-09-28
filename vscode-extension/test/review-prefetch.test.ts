import assert from 'node:assert/strict';
import test from 'node:test';
import type { LocalReviewExecutor } from '@gcr/client-core';
import { contentHash } from '@gcr/client-core';
import type { SourceFile } from '@gcr/client-contract';
import { prefetchReviewSource, reviewPrefetchTargets, type ReviewPrefetchMetrics } from '../src/reviewPrefetch.js';
import { captureLocalSource } from '@gcr/client-core';
import { fixture } from './helpers/review-fixture.js';

const file = (path: string, side: 'source' | 'base' = 'source', lineCount = 10): SourceFile => ({path,side,lineCount,byteLength:20,hash:'a'.repeat(64)});
const metric = (): ReviewPrefetchMetrics => ({reads:0,bytes:0,prefetchMs:0,modelMs:0});
const descriptor: LocalReviewExecutor['descriptor'] = {id:'codex-account',version:'test',model:'selected-model',configHash:contentHash('selected-effort'),capabilities:{available:true,sourceIsolation:'fixed-source-only',cancellation:true,timeout:true,childProcessCleanup:true,outputTokenLimit:false}};
const read = (args: any, text = 'fixed lines') => JSON.stringify({status:'available',source:file(args.path,args.side),startLine:args.startLine,endLine:args.endLine,text,readId:`${args.side}:${args.path}:${args.startLine}`,truncated:false});

test('supplies unique selected/base receipts without another model or broader source grant', async () => {
  const stats=metric(), calls: any[]=[];
  const source={async execute(name: string,args: any){ calls.push({name,args});return read(args); }};
  const signal=new AbortController().signal;
  const executor:LocalReviewExecutor={descriptor,async review(input){
    assert.equal(input.signal,signal); assert.equal(input.source,source);
    const data=JSON.parse(input.prompt.slice(input.prompt.lastIndexOf('\n')+1));
    assert.deepEqual(data.fixedSourceReads.map((r:any)=>r.readId),['source:api.ts:1','source:api.ts:201','base:api.ts:1']);
    assert.match(input.prompt,/may be incomplete/);
    assert.match(input.prompt,/Every readIds array must contain UNIQUE IDs/);
    assert(input.timeoutMs>0&&input.timeoutMs<=1000);
    return {raw:'response',model:descriptor.model};
  }};
  const optimized=prefetchReviewSource(executor,[file('api.ts','source',250),file('api.ts','base'),file('api.ts','base')],stats);
  assert.equal(optimized.descriptor,descriptor);
  assert.equal((await optimized.review({prompt:'policy',source,signal,timeoutMs:1000})).raw,'response');
  assert.equal(calls.length,3);assert.equal(stats.reads,3);
});
test('bounds preload by reads and bytes, leaving remaining coverage to existing tools', async()=>{
  for(const big of [false,true]){
    const stats=metric(); let calls=0;
    const optimized=prefetchReviewSource({descriptor,async review(input){
      const data=input.prompt.includes('fixedSourceReads')?JSON.parse(input.prompt.slice(input.prompt.lastIndexOf('\n')+1)):undefined;
      assert(Buffer.byteLength(JSON.stringify(data?.fixedSourceReads??[]))<=65536);
      return {raw:'ok',model:descriptor.model};
    }},[file('large.ts','source',10000)],stats);
    await optimized.review({prompt:'policy',timeoutMs:1000,source:{async execute(_name,args){calls++;return read(args,big?'x'.repeat(40000):'x');}}});
    assert.equal(stats.reads,big?1:24);assert.equal(calls,big?2:24);
  }
});
test('never invokes the model after revocation, cancellation or exhausted duration',async()=>{
  for(const failure of ['revoked','cancelled','timeout']){
    let models=0;const controller=new AbortController();
    const optimized=prefetchReviewSource({descriptor,async review(){models++;return {raw:'',model:descriptor.model};}},[file('api.ts')],metric());
    await assert.rejects(optimized.review({prompt:'policy',timeoutMs:failure==='timeout'?1:1000,signal:controller.signal,source:{async execute(_name,args){
      if(failure==='revoked')throw Object.assign(Error('revoked'),{code:'revoked'});
      if(failure==='cancelled')controller.abort();
      if(failure==='timeout')await new Promise(r=>setTimeout(r,5));
      return read(args);
    }}}));assert.equal(models,0);
  }
});
test('truncated or oversized source is never advertised as preloaded coverage',async()=>{
  for(const truncated of [true,false]){
    const stats=metric();const optimized=prefetchReviewSource({descriptor,async review(input){assert.equal(input.prompt,'policy');return {raw:'ok',model:descriptor.model};}},[file('api.ts')],stats);
    await optimized.review({prompt:'policy',timeoutMs:1000,source:{async execute(_name,args){return JSON.stringify({...JSON.parse(read(args,truncated?'small':'x'.repeat(70000))),truncated});}}});
    assert.equal(stats.reads,0);
  }
});

test('local import matching includes callers/tests but never excluded or unrelated source', t=>{
  const f=fixture();t.after(f.cleanup);
  f.write('lib/api.ts','export const total = 1;\n');
  f.write('invoice.ts', 'import { total } from "./lib/api";\nexport const amount = total;\n');
  f.write('api.test.ts', 'import { total } from "./lib/api";\n');
  f.write('large-example.ts', 'import { total } from "./lib/api";\n' + '// example\n'.repeat(2000));
  f.write('other.ts', 'import { total } from "./lib/not-api";\n');
  f.write('.env', 'from lib.api import total\n');
  f.git('add','.');f.git('commit','-m','base');f.write('lib/api.ts','export const total = 2;\n');
  const snapshot=captureLocalSource({cwd:f.repo,kind:'working-tree',paths:['lib/api.ts']});
  try {
    const targets=reviewPrefetchTargets(snapshot,[]);
    assert.deepEqual(targets.slice(0,2).map(f=>f.path),['lib/api.ts','lib/api.ts']);
    assert.deepEqual(new Set(targets.slice(2).map(f=>f.path)),new Set(['invoice.ts','api.test.ts']));
    assert(!targets.some(f=>['.env','other.ts','large-example.ts'].includes(f.path)));
    assert.equal(snapshot.readFile('large-example.ts','source').status,'available');
  } finally {snapshot.close();}
});
