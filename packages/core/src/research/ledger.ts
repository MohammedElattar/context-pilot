import { getDb } from '../db/connection.js';
import type Database from 'better-sqlite3';

export interface ResearchLedgerEntry {
  session_id?: string | null;
  url_hash?: string | null;
  normalized_url?: string | null;
  focus?: string | null;
  tool: string;
  cache_hit?: boolean;
  deduplicated?: boolean;
  est_tokens_in?: number | null;
  est_tokens_out?: number | null;
  est_tokens_saved?: number | null;
  ok: boolean;
  code?: string | null;
  timestamp_ms?: number;
}

/** Best-effort ledger write (fail-open: telemetry never breaks a fetch). */
export function recordResearch(entry: ResearchLedgerEntry, db: Database.Database = getDb()): void {
  try {
    db.prepare(`
      INSERT INTO research_ledger
        (session_id, url_hash, normalized_url, focus, tool, cache_hit, deduplicated,
         est_tokens_in, est_tokens_out, est_tokens_saved, ok, code, timestamp_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.session_id ?? null,
      entry.url_hash ?? null,
      entry.normalized_url ?? null,
      entry.focus ?? null,
      entry.tool,
      entry.cache_hit ? 1 : 0,
      entry.deduplicated ? 1 : 0,
      entry.est_tokens_in ?? null,
      entry.est_tokens_out ?? null,
      entry.est_tokens_saved ?? null,
      entry.ok ? 1 : 0,
      entry.code ?? null,
      entry.timestamp_ms ?? Date.now(),
    );
  } catch { /* fail open */ }
}

/** Latest session id, for attributing a gateway call. Null when none exists. */
export function resolveLatestSession(db: Database.Database = getDb()): string | null {
  try {
    const row = db.prepare('SELECT id FROM sessions ORDER BY started_at DESC LIMIT 1').get() as { id: string } | undefined;
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export interface ResearchSummary {
  session_id: string | null;
  routed_calls: number;
  searched: number;
  cache_hits: number;
  deduplicated: number;
  failed_calls: number;
  est_tokens_in: number;
  est_tokens_out: number;
  est_tokens_saved: number;
  cache_hit_rate: number;
  /** Native WebFetch/WebSearch calls observed for the session (not routed). */
  bypassed_native_calls: number;
  /** routed / (routed + bypassed); null when there was no research activity. */
  routing_adoption_rate: number | null;
}

/**
 * Summarize gateway usage for a session: routed gateway calls vs native
 * WebFetch/WebSearch calls (the adoption metric), cache hit-rate, and the
 * estimated within-gateway token savings. All figures are estimates.
 */
export function getResearchSummary(sessionId?: string | null, db: Database.Database = getDb()): ResearchSummary {
  const empty: ResearchSummary = {
    session_id: sessionId ?? null, routed_calls: 0, searched: 0, cache_hits: 0, deduplicated: 0,
    failed_calls: 0, est_tokens_in: 0, est_tokens_out: 0, est_tokens_saved: 0,
    cache_hit_rate: 0, bypassed_native_calls: 0, routing_adoption_rate: null,
  };
  try {
    // sessionId === null means aggregate across ALL sessions (dashboard view);
    // undefined means the latest session (research_state view).
    const allSessions = sessionId === null;
    const sid = allSessions ? null : (sessionId ?? resolveLatestSession(db));
    const where = sid ? 'WHERE session_id = ?' : '';
    const params = sid ? [sid] : [];
    const r = db.prepare(`
      SELECT
        COUNT(*) AS routed,
        COALESCE(SUM(CASE WHEN tool = 'contextpilot_search' THEN 1 ELSE 0 END), 0) AS searched,
        COALESCE(SUM(cache_hit), 0) AS hits,
        COALESCE(SUM(deduplicated), 0) AS dups,
        COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(SUM(est_tokens_in), 0) AS tin,
        COALESCE(SUM(est_tokens_out), 0) AS tout,
        COALESCE(SUM(est_tokens_saved), 0) AS saved
      FROM research_ledger ${where}
    `).get(...params) as any;

    const bypassed = allSessions
      ? ((db.prepare(`SELECT COUNT(*) AS n FROM events WHERE tool_name IN ('WebFetch','WebSearch')`).get() as any)?.n ?? 0)
      : sid
        ? ((db.prepare(`SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND tool_name IN ('WebFetch','WebSearch')`).get(sid) as any)?.n ?? 0)
        : 0;

    const routed = r?.routed ?? 0;
    const total = routed + bypassed;
    return {
      session_id: sid,
      routed_calls: routed,
      searched: r?.searched ?? 0,
      cache_hits: r?.hits ?? 0,
      deduplicated: r?.dups ?? 0,
      failed_calls: r?.failed ?? 0,
      est_tokens_in: r?.tin ?? 0,
      est_tokens_out: r?.tout ?? 0,
      est_tokens_saved: r?.saved ?? 0,
      cache_hit_rate: routed > 0 ? Number(((r?.hits ?? 0) / routed).toFixed(3)) : 0,
      bypassed_native_calls: bypassed,
      routing_adoption_rate: total > 0 ? Number((routed / total).toFixed(3)) : null,
    };
  } catch {
    return empty;
  }
}
