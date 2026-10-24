import { getModelPricing, PRICING, type PricingTable, type ModelPricing } from './pricing.js';

export interface TokenCounts {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
}

export interface CostEstimate {
  /** Sum of all priced components, USD. */
  usd: number;
  /** Per-kind USD for the components we had a rate for. */
  breakdown: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  /** Tokens present in the input but with no published rate, so not in `usd`. */
  unpriced: {
    cacheRead: number;
    cacheWrite: number;
  };
  /** True when some non-zero token kind had no rate — `usd` is a lower bound. */
  partial: boolean;
  modelId: string;
  pricingVersion: string;
  kind: 'estimated';
}

function price(tokens: number, ratePerMTok: number | undefined): { usd: number; unpriced: number } {
  if (tokens <= 0) return { usd: 0, unpriced: 0 };
  if (ratePerMTok == null) return { usd: 0, unpriced: tokens };
  return { usd: (tokens / 1_000_000) * ratePerMTok, unpriced: 0 };
}

/**
 * Estimate USD cost for a token count under a model's list pricing.
 * Pure. Returns `null` when the model has no pricing entry (unavailable).
 * A token kind with no published rate is reported in `unpriced` and sets
 * `partial`, so the estimate is never silently inflated or zeroed.
 */
export function estimateCost(
  tokens: TokenCounts,
  modelId: string | null | undefined,
  table?: PricingTable,
  overridePricing?: ModelPricing,
): CostEstimate | null {
  const pricing = overridePricing ?? getModelPricing(modelId, table);
  if (!pricing || !modelId) return null;

  const input = Math.max(0, tokens.input ?? 0);
  const output = Math.max(0, tokens.output ?? 0);
  const cacheRead = Math.max(0, tokens.cacheRead ?? 0);
  const cacheWrite = Math.max(0, tokens.cacheWrite ?? 0);

  const i = price(input, pricing.inputPerMTok);
  const o = price(output, pricing.outputPerMTok);
  const cr = price(cacheRead, pricing.cacheReadPerMTok);
  const cw = price(cacheWrite, pricing.cacheWritePerMTok);

  const usd = i.usd + o.usd + cr.usd + cw.usd;
  const partial = cr.unpriced > 0 || cw.unpriced > 0;

  return {
    usd,
    breakdown: { input: i.usd, output: o.usd, cacheRead: cr.usd, cacheWrite: cw.usd },
    unpriced: { cacheRead: cr.unpriced, cacheWrite: cw.unpriced },
    partial,
    modelId,
    pricingVersion: (table ?? PRICING).version,
    kind: 'estimated',
  };
}
