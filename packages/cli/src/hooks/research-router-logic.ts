// Pure decision logic for the strict research router, separated for unit tests.

export const STRICT_REASON =
  'ContextPilot strict routing is on: use contextpilot_search (discovery), contextpilot_fetch (one URL), or contextpilot_research (several URLs / a GitHub issue or PR) instead of native {tool}. They return ranked, token-budgeted, cached evidence. If the gateway cannot fetch this, set CONTEXTPILOT_ALLOW_NATIVE=1 to allow native tools.';

export type RouterDecision = { decision: 'deny'; reason: string } | null;

export interface RouterEnv {
  allowNative: boolean;
  searxngUrl?: string;
  braveKey?: string;
}

/**
 * Deny native WebFetch/WebSearch so the model routes through the gateway.
 * Fail-open: if no search backend is configured (no SearXNG URL, no Brave key),
 * WebSearch is allowed through — blocking it would deadlock the model.
 * WebFetch is always redirected when strict is on (the gateway can always fetch).
 */
export function routeDecision(toolName: string | undefined, env: RouterEnv | boolean): RouterDecision {
  const resolved: RouterEnv = typeof env === 'boolean'
    ? { allowNative: env } : env;
  if (resolved.allowNative) return null;
  if (toolName === 'WebSearch') {
    const hasBackend = !!(resolved.searxngUrl || resolved.braveKey);
    if (!hasBackend) return null;
    return { decision: 'deny', reason: STRICT_REASON.replace('{tool}', toolName) };
  }
  if (toolName === 'WebFetch') {
    return { decision: 'deny', reason: STRICT_REASON.replace('{tool}', toolName) };
  }
  return null;
}
