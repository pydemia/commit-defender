/** Shared by request construction and the encrypted credential's destination binding. */
export const API_DEFAULT_ENDPOINTS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
} as const;
