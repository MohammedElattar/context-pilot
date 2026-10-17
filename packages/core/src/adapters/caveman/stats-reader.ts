import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { paths } from '../../config/paths.js';

export interface CavemanTokenStats {
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  savingsUsd: number;
  cacheHitRatio: number | null;
}

export interface CavemanSessionStats {
  sessionId: string;
  model: string | null;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  savingsUsd: number;
  firstTs: number;
  lastTs: number;
}

export function getCavemanTokenStats(sinceMs?: number): CavemanTokenStats | null {
  if (!existsSync(paths.caveman.db)) return null;

  try {
    const db = new Database(paths.caveman.db, { readonly: true });
    const where = sinceMs ? 'WHERE ts >= ?' : '';
    const params = sinceMs ? [sinceMs] : [];

    const row = db.prepare(`
      SELECT
        COUNT(*) as total_requests,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cached_input_tokens), 0) as cached_input_tokens,
        COALESCE(SUM(cache_creation_input_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
        COALESCE(SUM(savings_usd), 0) as savings_usd
      FROM requests ${where}
    `).get(...params) as any;

    db.close();

    return {
      totalRequests: row.total_requests,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cachedInputTokens: row.cached_input_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      totalCostUsd: row.total_cost_usd,
      savingsUsd: row.savings_usd,
      cacheHitRatio: row.input_tokens > 0 ? row.cached_input_tokens / row.input_tokens : null,
    };
  } catch {
    return null;
  }
}

export function getCavemanSessionStats(limit = 10): CavemanSessionStats[] {
  if (!existsSync(paths.caveman.db)) return [];

  try {
    const db = new Database(paths.caveman.db, { readonly: true });

    const rows = db.prepare(`
      SELECT
        session_id,
        MAX(model) as model,
        COUNT(*) as requests,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cached_input_tokens), 0) as cached_input_tokens,
        COALESCE(SUM(cache_creation_input_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
        COALESCE(SUM(savings_usd), 0) as savings_usd,
        MIN(ts) as first_ts,
        MAX(ts) as last_ts
      FROM requests
      WHERE session_id IS NOT NULL
      GROUP BY session_id
      ORDER BY MAX(ts) DESC
      LIMIT ?
    `).all(limit) as any[];

    db.close();

    return rows.map(r => ({
      sessionId: r.session_id,
      model: r.model,
      requests: r.requests,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cachedInputTokens: r.cached_input_tokens,
      cacheCreationTokens: r.cache_creation_tokens,
      totalCostUsd: r.total_cost_usd,
      savingsUsd: r.savings_usd,
      firstTs: r.first_ts,
      lastTs: r.last_ts,
    }));
  } catch {
    return [];
  }
}
