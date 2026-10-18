// Pure logic for the research advisor, separated so it can be unit-tested
// without the hook's stdin side effects.

export const SUGGEST_FETCH =
  'ContextPilot: for bug-hunting, consider contextpilot_fetch (ranked, token-budgeted, cached, exact errors preserved) instead of WebFetch; expand with contextpilot_expand. Native tools remain fine.';
export const SUGGEST_SEARCH =
  'ContextPilot: after WebSearch, pass the chosen URLs to contextpilot_research to fetch+rank them under a token budget with provenance. Native tools remain fine.';
export const SUGGEST_BASH =
  'ContextPilot: fetching a URL in Bash pulls raw bytes into context; contextpilot_fetch returns ranked, budgeted, cached evidence instead. For a GitHub issue/PR, contextpilot_research takes the URL directly.';

const NETWORK_BASH = /\b(curl|wget|http|https|gh\s+api|gh\s+issue\s+view|gh\s+pr\s+view)\b/;

/** Returns a suggestion string for a native research tool, else null (silent). */
export function suggestionFor(toolName: string | undefined, toolInput: unknown): string | null {
  if (toolName === 'WebFetch') return SUGGEST_FETCH;
  if (toolName === 'WebSearch') return SUGGEST_SEARCH;
  if (toolName === 'Bash') {
    let cmd = '';
    try {
      const ti = typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput;
      cmd = String((ti as any)?.command ?? '');
    } catch { /* ignore */ }
    if (cmd && NETWORK_BASH.test(cmd)) return SUGGEST_BASH;
  }
  return null;
}
