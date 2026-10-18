import type Database from 'better-sqlite3';
import { getDb } from '../db/connection.js';
import { getCavemanSessionStats } from '../adapters/caveman/stats-reader.js';
import { estimateCost, type CostEstimate } from './estimate.js';

export { PRICING, getModelPricing, type ModelPricing, type PricingTable } from './pricing.js';
export { estimateCost, type CostEstimate, type TokenCounts } from './estimate.js';

export interface BilledCost {
  usd: number;
  source: 'caveman';
}

export interface SessionCost {
  sessionId: string;
  model: string | null;
  /** Our own estimate from recorded token snapshots; null when unavailable. */
  estimated: CostEstimate | null;
  /** Caveman's recorded USD for this session; null when not found. */
  billed: BilledCost | null;
}

/**
 * Cost for one session: our estimate from `token_snapshots`, plus Caveman's
 * billed USD when Caveman recorded the same session id. Read-only and
 * fail-open — any error yields nulls rather than throwing.
 */
export function getSessionCost(sessionId: string, db?: Database.Database): SessionCost {
  const base: SessionCost = { sessionId, model: null, estimated: null, billed: null };
  try {
    const d = db ?? getDb();

    const session = d
      .prepare('SELECT model FROM sessions WHERE id = ?')
      .get(sessionId) as { model: string | null } | undefined;
    base.model = session?.model ?? null;

    const row = d
      .prepare(`
        SELECT
          COALESCE(SUM(input_tokens), 0) AS input,
          COALESCE(SUM(output_tokens), 0) AS output,
          COALESCE(SUM(cache_read_tokens), 0) AS cacheRead,
          COALESCE(SUM(cache_write_tokens), 0) AS cacheWrite,
          COUNT(*) AS snapshots
        FROM token_snapshots
        WHERE session_id = ? AND (usage_kind = 'observed' OR usage_kind IS NULL)
      `)
      .get(sessionId) as {
        input: number; output: number; cacheRead: number; cacheWrite: number; snapshots: number;
      };

    if (row.snapshots > 0) {
      base.estimated = estimateCost(
        { input: row.input, output: row.output, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite },
        base.model,
      );
    }
  } catch {
    // fail open — estimate stays null
  }

  try {
    const billed = getCavemanSessionStats(200).find(s => s.sessionId === sessionId);
    if (billed && billed.totalCostUsd > 0) {
      base.billed = { usd: billed.totalCostUsd, source: 'caveman' };
    }
  } catch {
    // fail open — billed stays null
  }

  return base;
}
