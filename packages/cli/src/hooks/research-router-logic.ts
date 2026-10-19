// Pure decision logic for the strict research router, separated for unit tests.

export const STRICT_REASON =
  'ContextPilot strict routing is on: use contextpilot_search (discovery), contextpilot_fetch (one URL), or contextpilot_research (several URLs / a GitHub issue or PR) instead of native {tool}. They return ranked, token-budgeted, cached evidence. If the gateway cannot fetch this, set CONTEXTPILOT_ALLOW_NATIVE=1 to allow native tools.';

export type RouterDecision = { decision: 'deny'; reason: string } | null;

/**
 * Deny native WebFetch/WebSearch so the model routes through the gateway. The
 * `CONTEXTPILOT_ALLOW_NATIVE` escape (allowNative=true) disables the block — a
 * deadlock guard for when the gateway genuinely cannot fetch. Null = stay silent
 * (do not touch the call), so a router error fails open to native.
 */
export function routeDecision(toolName: string | undefined, allowNative: boolean): RouterDecision {
  if (allowNative) return null;
  if (toolName === 'WebFetch' || toolName === 'WebSearch') {
    return { decision: 'deny', reason: STRICT_REASON.replace('{tool}', toolName) };
  }
  return null;
}
