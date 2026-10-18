// Versioned, local model-pricing table for cost ESTIMATION.
//
// These are public Anthropic list prices in USD per million tokens, captured on
// the date in `asOf`. They are NOT billed figures — Caveman's own recorded USD
// is the billed source. A rate we are not confident about is omitted rather than
// guessed, so a token kind with no rate stays explicitly unpriced (see estimate.ts)
// and an unknown model resolves to `undefined` (unavailable), never to 0.
//
// To update: bump `version`/`asOf`, edit `source`, and change only verified rates.

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Omitted when the published cache-read rate is not confidently known. */
  cacheReadPerMTok?: number;
  /** Omitted when the published cache-write rate is not confidently known. */
  cacheWritePerMTok?: number;
}

export interface PricingTable {
  version: string;
  asOf: string;
  currency: 'USD';
  source: string;
  models: Record<string, ModelPricing>;
}

export const PRICING: PricingTable = {
  version: '2026-10-06',
  asOf: '2026-10-06',
  currency: 'USD',
  source: 'Anthropic public list pricing (per MTok). Cache-read rates included only where published explicitly; cache-write rates not yet captured.',
  models: {
    'claude-fable-5-1': { inputPerMTok: 10, outputPerMTok: 50 },
    'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50 },
    'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 },
    'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.2 },
    'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
    'claude-opus-4-7': { inputPerMTok: 5, outputPerMTok: 25 },
    'claude-opus-4-6': { inputPerMTok: 5, outputPerMTok: 25 },
    'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
    'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
    'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
    'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5 },
    'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  },
};

/**
 * Resolve a Claude Code model string to its pricing entry.
 * Tries an exact match first, then the longest known id that the model string
 * starts with (tolerates a trailing date snapshot like `-20260401`).
 * Returns `undefined` when no confident match exists — the caller treats that
 * as "unavailable", never as free.
 */
export function getModelPricing(
  modelId: string | null | undefined,
  table: PricingTable = PRICING,
): ModelPricing | undefined {
  if (!modelId) return undefined;
  const exact = table.models[modelId];
  if (exact) return exact;

  let best: { id: string; pricing: ModelPricing } | null = null;
  for (const [id, pricing] of Object.entries(table.models)) {
    if (modelId.startsWith(id) && (!best || id.length > best.id.length)) {
      best = { id, pricing };
    }
  }
  return best?.pricing;
}
