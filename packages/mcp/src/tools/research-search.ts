import { searchWeb, recordResearch, resolveLatestSession } from '@contextpilot/core';

/**
 * contextpilot_search handler. Free-text query → ranked result URLs + snippets
 * via SearXNG (free, self-hosted) or Brave, else a fail-open note pointing at
 * native WebSearch. Records a ledger row. Feed the returned URLs to
 * contextpilot_research to fetch them under a token budget.
 */
export async function handleResearchSearch(args: { query?: string; limit?: number }) {
  if (!args.query || typeof args.query !== 'string') {
    return { ok: false, error: 'Missing required "query" argument.', code: 'bad_args', fallback: 'Use native WebSearch instead.' };
  }
  const result = await searchWeb(args.query, { limit: args.limit });

  try {
    const est = Math.ceil(JSON.stringify(result).length / 4);
    recordResearch({
      session_id: resolveLatestSession(),
      tool: 'contextpilot_search',
      focus: args.query,
      ok: result.ok,
      code: result.ok ? null : result.code,
      est_tokens_out: est,
    });
  } catch { /* telemetry is best-effort */ }

  return result;
}
