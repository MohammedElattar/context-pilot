import { fetchResearch } from '@contextpilot/core';

/**
 * contextpilot_fetch handler. Returns budget-capped ranked evidence with stable
 * evidence_ids; omitted sections stay in the cache and are recoverable via
 * contextpilot_expand. Fail-open: errors come back as a structured result that
 * points the model at the native fetch tools, never a thrown exception.
 */
export async function handleResearchFetch(args: {
  url?: string;
  focus?: string;
  budget_tokens?: number;
}) {
  if (!args.url || typeof args.url !== 'string') {
    return { ok: false, error: 'Missing required "url" argument.', code: 'bad_args', fallback: 'Use native WebFetch instead.' };
  }
  return fetchResearch({ url: args.url, focus: args.focus, budget_tokens: args.budget_tokens });
}
