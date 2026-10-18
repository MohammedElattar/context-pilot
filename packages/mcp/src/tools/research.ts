import { researchQuery, realGhExec } from '@contextpilot/core';

/**
 * contextpilot_research handler. Researches a question across one or more
 * provided URLs (web/doc pages and GitHub issues/PRs), returning merged,
 * budget-capped evidence with per-source provenance. GitHub refs use the user's
 * `gh` auth. Fail-open: a bad source is reported, never thrown.
 */
export async function handleResearch(args: {
  query?: string;
  urls?: string[];
  budget_tokens?: number;
}) {
  if (!args.query || typeof args.query !== 'string') {
    return { ok: false, error: 'Missing required "query" argument.', code: 'bad_args', fallback: 'Use native WebSearch instead.' };
  }
  const urls = Array.isArray(args.urls) ? args.urls.filter(u => typeof u === 'string') : [];
  return researchQuery({ query: args.query, urls, budget_tokens: args.budget_tokens, ghExec: realGhExec });
}
