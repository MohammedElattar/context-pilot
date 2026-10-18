import type { RankedSection } from './rank.js';

/** Rough token estimate (~4 chars/token). Labelled 'estimated' everywhere. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface BudgetResult {
  included: RankedSection[];
  omitted: RankedSection[];
  estTokensIn: number;
  estTokensOut: number;
  /** True when a protected section pushed the result past the budget. */
  overflow: boolean;
}

/**
 * Trim ranked sections to a token budget. Sections holding an exact error match
 * are included unconditionally and first — essential evidence is never silently
 * dropped, even if it alone exceeds the budget (overflow is flagged instead).
 * Remaining budget is filled by score; the rest is omitted but stays in the
 * cache, recoverable by evidence_id via expand.
 */
export function enforceBudget(ranked: RankedSection[], budgetTokens: number): BudgetResult {
  const estTokensIn = ranked.reduce((sum, s) => sum + estimateTokens(s.text), 0);

  const protectedSecs = ranked.filter(s => s.hasErrorMatch);
  const rest = ranked.filter(s => !s.hasErrorMatch);

  const included: RankedSection[] = [];
  let used = 0;
  let overflow = false;

  for (const s of protectedSecs) {
    included.push(s);
    used += estimateTokens(s.text);
  }
  if (used > budgetTokens) overflow = true;

  for (const s of rest) {
    const cost = estimateTokens(s.text);
    if (used + cost > budgetTokens) continue;
    included.push(s);
    used += cost;
  }

  const includedIdx = new Set(included.map(s => s.index));
  const omitted = ranked.filter(s => !includedIdx.has(s.index));

  // Preserve document order within the included set for readability.
  included.sort((a, b) => a.index - b.index);

  return { included, omitted, estTokensIn, estTokensOut: used, overflow };
}
