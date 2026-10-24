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

export interface CavemanLatestRequest {
  request_id: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
}

export function getLatestCavemanRequest(sessionId: string): CavemanLatestRequest | null {
  if (!existsSync(paths.caveman.db)) return null;

  try {
    const db = new Database(paths.caveman.db, { readonly: true });
    const row = db.prepare(`
      SELECT request_id, input_tokens, output_tokens,
             cached_input_tokens, cache_creation_input_tokens
      FROM requests
      WHERE session_id = ?
      ORDER BY ts DESC
      LIMIT 1
    `).get(sessionId) as any | undefined;
    db.close();

    if (!row?.request_id) return null;
    return {
      request_id: row.request_id,
      input_tokens: row.input_tokens ?? 0,
      output_tokens: row.output_tokens ?? 0,
      cached_input_tokens: row.cached_input_tokens ?? 0,
      cache_creation_input_tokens: row.cache_creation_input_tokens ?? 0,
    };
  } catch {
    return null;
  }
}

export interface CavemanModeHistoryEntry {
  session_id: string;
  mode: string | null;
  model: string | null;
  output_tokens: number;
  cache_read_input_tokens: number;
}

/**
 * Per-session mode summary from the Caveman requests table.
 * Used as a live replacement for the legacy .caveman-history.jsonl.
 */
export function getCavemanModeHistory(limit = 20): CavemanModeHistoryEntry[] {
  if (!existsSync(paths.caveman.db)) return [];

  try {
    const db = new Database(paths.caveman.db, { readonly: true });

    const rows = db.prepare(`
      SELECT
        session_id,
        MAX(runtime_mode) as mode,
        MAX(model) as model,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cached_input_tokens), 0) as cache_read_input_tokens
      FROM requests
      WHERE session_id IS NOT NULL
      GROUP BY session_id
      ORDER BY MAX(ts) DESC
      LIMIT ?
    `).all(limit) as any[];

    db.close();

    return rows.map(r => ({
      session_id: r.session_id,
      mode: r.mode,
      model: r.model,
      output_tokens: r.output_tokens,
      cache_read_input_tokens: r.cache_read_input_tokens,
    }));
  } catch {
    return [];
  }
}

export interface CavemanLearnSink {
  sink_id: string;
  title: string;
  class: string;
  tokens_per_turn: number;
  tokens_observed: number;
  suggestion: string;
}

export function getCavemanLearnSinks(): CavemanLearnSink[] {
  if (!existsSync(paths.caveman.db)) return [];

  try {
    const db = new Database(paths.caveman.db, { readonly: true });
    const rows = db.prepare(`
      SELECT sink_id, title, class, tokens_per_turn, tokens_observed, suggestion
      FROM learn_sinks
      ORDER BY tokens_per_turn DESC
    `).all() as any[];
    db.close();

    return rows.map(r => ({
      sink_id: r.sink_id,
      title: r.title,
      class: r.class,
      tokens_per_turn: r.tokens_per_turn ?? 0,
      tokens_observed: r.tokens_observed ?? 0,
      suggestion: r.suggestion ?? '',
    }));
  } catch {
    return [];
  }
}

export interface InputOptimizationStats {
  optimizedRequests: number;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  savingsRatio: number | null;
}

export function getInputOptimizationStats(): InputOptimizationStats | null {
  if (!existsSync(paths.caveman.db)) return null;

  try {
    const db = new Database(paths.caveman.db, { readonly: true });
    const row = db.prepare(`
      SELECT
        COUNT(*) as optimized_requests,
        COALESCE(SUM(request_tokens_before), 0) as before_total,
        COALESCE(SUM(request_tokens_after), 0) as after_total,
        COALESCE(SUM(request_tokens_before - request_tokens_after), 0) as saved
      FROM requests
      WHERE request_tokens_before > request_tokens_after
    `).get() as any;
    db.close();

    return {
      optimizedRequests: row.optimized_requests,
      tokensBefore: row.before_total,
      tokensAfter: row.after_total,
      tokensSaved: row.saved,
      savingsRatio: row.before_total > 0 ? row.saved / row.before_total : null,
    };
  } catch {
    return null;
  }
}

export interface InputOptimizationTimelineEntry {
  sessionId: string;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
}

export function getInputOptimizationTimeline(limit = 20): InputOptimizationTimelineEntry[] {
  if (!existsSync(paths.caveman.db)) return [];

  try {
    const db = new Database(paths.caveman.db, { readonly: true });
    const rows = db.prepare(`
      SELECT
        session_id,
        COALESCE(SUM(request_tokens_before), 0) as before_total,
        COALESCE(SUM(request_tokens_after), 0) as after_total,
        COALESCE(SUM(request_tokens_before - request_tokens_after), 0) as saved
      FROM requests
      WHERE session_id IS NOT NULL AND request_tokens_before > request_tokens_after
      GROUP BY session_id
      ORDER BY MAX(ts) DESC
      LIMIT ?
    `).all(limit) as any[];
    db.close();

    return rows.map(r => ({
      sessionId: r.session_id,
      tokensBefore: r.before_total,
      tokensAfter: r.after_total,
      tokensSaved: r.saved,
    }));
  } catch {
    return [];
  }
}

export interface CompressionStats {
  compressedRequests: number;
  avgCompressionRatio: number;
  tokensBefore: number;
  tokensAfter: number;
}

export function getCompressionStats(): CompressionStats | null {
  if (!existsSync(paths.caveman.db)) return null;

  try {
    const db = new Database(paths.caveman.db, { readonly: true });
    const row = db.prepare(`
      SELECT
        COUNT(*) as cnt,
        AVG(compression_ratio) as avg_ratio,
        COALESCE(SUM(compression_tokens_before), 0) as before_total,
        COALESCE(SUM(compression_tokens_after), 0) as after_total
      FROM requests
      WHERE compression_ratio IS NOT NULL AND compression_ratio > 0
    `).get() as any;
    db.close();

    if (!row.cnt) return null;
    return {
      compressedRequests: row.cnt,
      avgCompressionRatio: row.avg_ratio,
      tokensBefore: row.before_total,
      tokensAfter: row.after_total,
    };
  } catch {
    return null;
  }
}

export interface CacheIntelligence {
  hits: number;
  misses: number;
  writes: number;
  unknown: number;
  hitRate: number | null;
}

export function getCacheIntelligence(): CacheIntelligence | null {
  if (!existsSync(paths.caveman.db)) return null;

  try {
    const db = new Database(paths.caveman.db, { readonly: true });
    const rows = db.prepare(`
      SELECT cache_status, COUNT(*) as cnt
      FROM requests
      WHERE cache_status IS NOT NULL
      GROUP BY cache_status
    `).all() as { cache_status: string; cnt: number }[];
    db.close();

    const dist: Record<string, number> = {};
    for (const r of rows) dist[r.cache_status] = r.cnt;

    const hits = dist['hit'] ?? 0;
    const misses = dist['miss'] ?? 0;
    const writes = dist['write'] ?? 0;
    const unknown = dist['unknown'] ?? 0;
    const known = hits + misses + writes;

    return {
      hits,
      misses,
      writes,
      unknown,
      hitRate: known > 0 ? hits / known : null,
    };
  } catch {
    return null;
  }
}

export interface CavemanModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

export function getCavemanPricing(modelId: string): CavemanModelPricing | null {
  if (!existsSync(paths.caveman.db)) return null;

  try {
    const db = new Database(paths.caveman.db, { readonly: true });
    const row = db.prepare(`
      SELECT price_input_per_million, price_output_per_million,
             price_cache_read_per_million, price_cache_write_per_million
      FROM requests
      WHERE pricing_known = 1 AND model = ?
      ORDER BY ts DESC
      LIMIT 1
    `).get(modelId) as any | undefined;
    db.close();

    if (!row || row.price_input_per_million == null) return null;
    const result: CavemanModelPricing = {
      inputPerMTok: row.price_input_per_million,
      outputPerMTok: row.price_output_per_million,
    };
    if (row.price_cache_read_per_million != null) result.cacheReadPerMTok = row.price_cache_read_per_million;
    if (row.price_cache_write_per_million != null) result.cacheWritePerMTok = row.price_cache_write_per_million;
    return result;
  } catch {
    return null;
  }
}
