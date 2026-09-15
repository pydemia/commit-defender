import { contentHash, type LocalReviewExecutor } from "@gcr/client-core";
import { prepareCodexAccountExecutor } from "@gcr/client-executors";
import { callProvider, type ProviderRequest } from "./ai/providers.js";
import {
  modelCredentialBinding,
  resolveModelCredential,
  usesModelApiKey,
  type ModelCredentialPorts,
} from "./modelCredentials.js";
import {
  StandaloneReviewError,
  type StandaloneReviewSettings,
} from "./standaloneReviewProtocol.js";

/** Reuse the API adapters with the same captured source port as Codex. These
 * adapters receive text only; they have no filesystem, tool or central-model port. */
export async function prepareLocalProviderExecutor(
  settings: StandaloneReviewSettings,
  ports: ModelCredentialPorts = {},
): Promise<LocalReviewExecutor> {
  if (settings.provider === "codex")
    return prepareCodexAccountExecutor({
      executablePath: settings.executablePath,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
    });
  if (!usesModelApiKey(settings.provider))
    throw new StandaloneReviewError("unsupported-provider");
  if (
    settings.reasoningEffort &&
    !["openai", "aoai"].includes(settings.provider)
  )
    throw new StandaloneReviewError("unsupported-reasoning");
  if (
    !settings.modelCredentialRef ||
    settings.modelCredentialRef.profileId !== settings.profileId
  )
    throw new StandaloneReviewError("credential-unavailable");
  const binding = modelCredentialBinding({
    aiProvider: settings.provider,
    model: settings.model,
    endpoint: settings.endpoint ?? "",
    apiVersion: settings.apiVersion ?? "",
  });
  // Only a destination-bound existing OS credential may supply the key.
  const apiKey = await resolveModelCredential(
    settings.modelCredentialRef,
    binding,
    ports,
  );
  const maxTokens = settings.maxTokens ?? 4096;
  if (!Number.isInteger(maxTokens) || maxTokens < 512 || maxTokens > 32000)
    throw new StandaloneReviewError("policy-unavailable");
  const descriptor = {
    id: settings.provider + "-api",
    version: "captured-source-v1",
    model: settings.model,
    configHash: contentHash({
      binding,
      reasoningEffort: settings.reasoningEffort,
      maxTokens,
      credential: settings.modelCredentialRef,
    }),
    capabilities: {
      available: true,
      sourceIsolation: "fixed-source-only" as const,
      cancellation: true,
      timeout: true,
      childProcessCleanup: true,
      outputTokenLimit: true,
    },
  };
  return {
    descriptor,
    async review(input) {
      const reads: unknown[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page = JSON.parse(
          await input.source.execute("list_files", { offset, limit: 100 }),
        );
        for (const file of page.files) {
          for (let line = 1; line <= file.lineCount;) {
            const read = JSON.parse(
              await input.source.execute("read_file", {
                path: file.path,
                side: file.side,
                startLine: line,
                endLine: Math.min(file.lineCount, line + 199),
              }),
            );
            if (
              read.status !== "available" ||
              read.truncated ||
              read.endLine < line
            )
              throw new StandaloneReviewError("needs-context");
            reads.push(read);
            line = read.endLine + 1;
          }
        }
        offset = page.nextOffset;
      }
      const request: ProviderRequest = {
        provider: settings.provider as
          "aoai" | "openai" | "anthropic" | "gemini",
        apiKey,
        endpoint: binding.endpoint,
        apiVersion: binding.apiVersion,
        model: settings.model,
        maxTokens,
        systemPrompt:
          input.prompt +
          "\nThe fixed source reads below have already been performed by the application. Use their exact readIds. No additional source tools are available to this provider. Request missing context instead of inventing it.",
        userMessage: JSON.stringify({ fixedSourceReads: reads }),
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        ...(settings.reasoningEffort
          ? { reasoningEffort: settings.reasoningEffort }
          : {}),
        noRetry: true,
      };
      const result = await callProvider(request);
      if (result.error || result.incomplete)
        throw new StandaloneReviewError(
          result.errorKind === "timeout" ? "timeout" : "model-failed",
        );
      return { raw: result.raw, model: settings.model };
    },
  };
}
