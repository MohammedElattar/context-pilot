import { getDb } from './connection.js';

export interface SessionSummary {
  id: string;
  started_at: number;
  ended_at: number | null;
  model: string | null;
  event_count: number;
  total_output_tokens: number | null;
  total_cache_read_tokens: number | null;
}

export interface TokenAggregate {
  total_input: number;
  total_output: number;
  total_cache_read: number;
  total_cache_write: number;
  snapshot_count: number;
}

export interface ToolUsageStat {
  tool_name: string;
  call_count: number;
  total_payload_bytes: number;
  avg_duration_ms: number | null;
}

export function getRecentSessions(limit = 20): SessionSummary[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      s.id,
      s.started_at,
      s.ended_at,
      s.model,
      COUNT(e.id) as event_count,
      (SELECT SUM(ts.output_tokens) FROM token_snapshots ts WHERE ts.session_id = s.id) as total_output_tokens,
      (SELECT SUM(ts.cache_read_tokens) FROM token_snapshots ts WHERE ts.session_id = s.id) as total_cache_read_tokens
    FROM sessions s
    LEFT JOIN events e ON e.session_id = s.id
    GROUP BY s.id
    ORDER BY s.started_at DESC
    LIMIT ?
  `).all(limit) as SessionSummary[];
}

export function getTokenAggregate(sinceMs?: number): TokenAggregate {
  const db = getDb();
  const where = sinceMs ? 'WHERE timestamp_ms >= ?' : '';
  const params = sinceMs ? [sinceMs] : [];

  const row = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as total_input,
      COALESCE(SUM(output_tokens), 0) as total_output,
      COALESCE(SUM(cache_read_tokens), 0) as total_cache_read,
      COALESCE(SUM(cache_write_tokens), 0) as total_cache_write,
      COUNT(*) as snapshot_count
    FROM token_snapshots
    ${where}
  `).get(...params) as TokenAggregate;

  return row;
}

export function getToolUsageStats(sinceMs?: number, limit = 20): ToolUsageStat[] {
  const db = getDb();
  const where = sinceMs ? 'WHERE e.timestamp_ms >= ? AND e.tool_name IS NOT NULL' : 'WHERE e.tool_name IS NOT NULL';
  const params = sinceMs ? [sinceMs, limit] : [limit];

  return db.prepare(`
    SELECT
      e.tool_name,
      COUNT(*) as call_count,
      COALESCE(SUM(e.payload_bytes), 0) as total_payload_bytes,
      AVG(e.duration_ms) as avg_duration_ms
    FROM events e
    ${where}
    GROUP BY e.tool_name
    ORDER BY call_count DESC
    LIMIT ?
  `).all(...params) as ToolUsageStat[];
}
