import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
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
