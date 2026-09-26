import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import fs from "node:fs";
import { fixture } from "./helpers/review-fixture.js";
import { prepareStandaloneReview } from "../src/standaloneReview.js";
import {
  modelCredentialBinding,
  saveModelCredential,
} from "../src/modelCredentials.js";
import type { StandaloneReviewSettings } from "../src/standaloneReviewProtocol.js";

for (const [provider, outcome] of [
  ["openai", "complete"],
  ["aoai", "complete"],
  ["anthropic", "complete"],
  ["gemini", "complete"],
  ["openai", "failed"],
  ["openai", "incomplete"],
] as const) {
  test(`${provider} ${outcome}: reviews captured source/base using the selected model and destination-bound credential`, async (t) => {
    const f = fixture();
    t.after(f.cleanup);
    f.write("sum.ts", "export const sum = 1;\n");
    f.git("add", ".");
    f.git("commit", "-m", "base");
    f.write("sum.ts", "export const sum = 2;\n");
    f.write(".env", "DO_NOT_SEND=secret");
    f.git("add", ".");
    const values = new Map<string, Buffer>();
    const ports = {
      dataDirectory: path.join(f.root, "data"),
      keys: {
        async read(id: string) {
          const value = values.get(id);
          return value ? Buffer.from(value) : undefined;
        },
        async write(id: string, value: Buffer) {
          values.set(id, Buffer.from(value));
        },
        async remove(id: string) {
          values.delete(id);
        },
      },
    };
    const binding = modelCredentialBinding({
      aiProvider: provider,
      endpoint: "https://model.example.invalid/v1",
      model: "user-selected-model",
      apiVersion: "fixture-version",
    });
    const ref = await saveModelCredential(
      "provider-test",
      binding,
      "synthetic-api-key",
      ports,
    );
    const settings: StandaloneReviewSettings = {
      mode: "standalone",
      profileId: "provider-test",
      provider,
      model: binding.model,
      reasoningEffort: ["openai", "aoai"].includes(provider) ? "high" : "",
      executablePath: "/must-not-run",
      workspaceTrusted: true,
      durationMs: 30000,
      excludePatterns: [],
      endpoint: binding.endpoint,
      apiVersion: binding.apiVersion,
      modelCredentialRef: ref,
    };
    let calls = 0;
    t.mock.method(
      globalThis,
      "fetch",
      async (url: string, options: RequestInit) => {
        calls++;
        assert(url.startsWith("https://model.example.invalid/v1/"));
        assert.equal(options.redirect, "error");
        const body = JSON.parse(String(options.body));
        assert(!String(options.body).includes("DO_NOT_SEND"));
        const input =
          provider === "gemini"
            ? body.contents[0].parts[0].text
            : body.messages.at(-1).content;
        const reads = JSON.parse(input).fixedSourceReads;
        assert(reads.some((r: any) => r.source.side === "source"));
        assert(reads.some((r: any) => r.source.side === "base"));
        if (["openai", "aoai"].includes(provider))
          assert.equal(body.reasoning_effort, "high");
        if (provider !== "aoai" && provider !== "gemini")
          assert.equal(body.model, settings.model);
        if (outcome === "failed")
          return new Response("Unavailable", { status: 503 });
        const raw = JSON.stringify({
          summary: "Reviewed supplied source",
          files: [
            {
              path: "sum.ts",
              side: "source",
              complete: true,
              summary: "Reviewed source and base",
              readIds: reads.map((r: any) => r.readId),
            },
          ],
          findings: [],
          questions: [],
        });
        return new Response(
          JSON.stringify(
            provider === "anthropic"
              ? {
                  content: [{ type: "text", text: raw }],
                  stop_reason: "end_turn",
                }
              : provider === "gemini"
                ? {
                    candidates: [
                      {
                        content: { parts: [{ text: raw }] },
                        finishReason: "STOP",
                      },
                    ],
                  }
                : {
                    choices: [
                      {
                        message: { content: raw },
                        finish_reason:
                          outcome === "incomplete" ? "length" : "stop",
                      },
                    ],
                  },
          ),
          { status: 200 },
        );
      },
    );
    const prepared = await prepareStandaloneReview(
      { repoRoot: f.repo, files: ["sum.ts"], scope: "staged" },
      settings,
      new AbortController().signal,
      ports,
    );
    try {
      const result = await prepared.run(new AbortController().signal);
      assert.equal(
        result.report.gcr?.report.status,
        outcome === "complete" ? "completed" : "failed",
      );
      assert.equal(calls, 1);
      assert.equal(
        result.report.gcr?.report.identity.executor.model,
        settings.model,
      );
      assert.equal(
        result.report.gcr?.report.identity.executor.id,
        provider + "-api",
      );
    } finally {
      prepared.dispose();
    }
  });
}

for (const provider of ['claudecode', 'antigravity'] as const) {
  for (const outcome of ['complete', 'invalid-read'] as const) {
    test(`${provider} ${outcome}: captured source/base report validation and sensitive exclusions`, { skip: process.platform === 'win32' }, async t => {
      const f = fixture(); t.after(f.cleanup);
      f.write('sum.ts', 'export const sum = 1;\n'); f.git('add', '.'); f.git('commit', '-m', 'base');
      f.write('sum.ts', 'export const sum = 2;\n'); f.write('.env', 'DO_NOT_SEND=secret\n'); f.git('add', '.');
      fs.writeFileSync(f.executable, `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);
if(args.includes('--help')) {console.error('--safe-mode --tools --strict-mcp-config --effort --agent --input-format --output-format --json-schema --disable-slash-commands');process.exit();}
if(args.includes('--version')) {console.log('fixture-1');process.exit();}
let text='';process.stdin.on('data',x=>text+=x);process.stdin.on('end',()=>{
 if(text.includes('DO_NOT_SEND'))process.exit(21);
 let request=JSON.parse(text);if(request.event==='user')request=JSON.parse(request.message.content.slice(request.message.content.lastIndexOf('\\n')+1));
 const reads=request.fixedSourceReads;if(!reads.some(r=>r.source?.side==='source')||!reads.some(r=>r.source?.side==='base'))process.exit(22);
 const raw={summary:'Reviewed captured source and base',files:[{path:'sum.ts',side:'source',complete:true,summary:'Reviewed both versions',readIds:${JSON.stringify(outcome)}==='invalid-read'?['forged-read']:reads.map(r=>r.readId)}],findings:[],questions:[]};
 if(${JSON.stringify(provider)}==='claudecode')console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:raw}));
 else { console.log(JSON.stringify({event:'init',init:{agent:args[args.indexOf('--agent')+1],tools:['finish','view_file']}}));console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',response:JSON.stringify(raw)}})); }
});
`, { mode: 0o700 });
      const settings: StandaloneReviewSettings = { mode:'standalone',profileId:'account-core-test',provider,
        model:'',reasoningEffort:'medium',executablePath:f.executable,workspaceTrusted:true,durationMs:30000,excludePatterns:[] };
      const keys = new Map<string, Buffer>();
      const prepared = await prepareStandaloneReview({repoRoot:f.repo,files:['sum.ts'],scope:'staged'}, settings,
        new AbortController().signal, { dataDirectory:path.join(f.root,'data'), keys:{async read(id){return keys.get(id)},async write(id,key){keys.set(id,Buffer.from(key))},async remove(id){keys.delete(id)}} });
      try {
        const result=await prepared.run(new AbortController().signal);
        assert.equal(result.report.gcr?.report.status,outcome==='complete'?'completed':'failed',JSON.stringify(result.report.gcr?.report));
        assert.equal(result.report.gcr?.report.identity.executor.id,provider+'-account');
        assert.equal(result.report.gcr?.report.identity.executor.model,'cli-default');
      } finally {prepared.dispose();}
    });
  }
}
