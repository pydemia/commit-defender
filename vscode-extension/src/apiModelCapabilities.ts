import type { ApiProvider } from './modelCredentials.js';

/** Only documented Chat Completions effort combinations are offered.
 * A deployment name is never interpreted as its underlying model identity. */
export function apiReasoningEfforts(provider: ApiProvider, model: string): string[] {
  if (!['openai', 'aoai'].includes(provider)) return [];
  if (/^(o3|o3-mini|o4-mini)(-\d{4}-\d{2}-\d{2})?$/.test(model)) return ['low', 'medium', 'high'];
  if (/^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/.test(model)) return ['minimal', 'low', 'medium', 'high'];
  if (/^gpt-5\.1(-\d{4}-\d{2}-\d{2})?$/.test(model)) return ['none', 'low', 'medium', 'high'];
  if (/^gpt-5\.(2|4|5)(-\d{4}-\d{2}-\d{2})?$/.test(model)) return ['none', 'low', 'medium', 'high', 'xhigh'];
  return [];
}
