import type { ClientIdentity } from "@gcr/client-contract";
export function reviewExecutionLabel(client: ClientIdentity): string {
  const execution = client.execution;
  if (!execution)
    return client.mode === "centralized" ? "Centralized" : "Standalone";
  if (execution.knowledgeSource === "central-online")
    return "Centralized · online";
  if (execution.knowledgeSource === "central-cache")
    return "Centralized · cached";
  return execution.configuredMode === "centralized"
    ? `Standalone · fallback: ${execution.fallbackReason}`
    : "Standalone";
}
