import { getDb } from './connection.js';
import type Database from 'better-sqlite3';

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

export interface FileReadStat {
  file_path: string;
  read_count: number;
  total_payload_bytes: number;
  first_read_ms: number;
  last_read_ms: number;
}

export function getSessionFileReads(sessionId: string, db?: Database.Database): FileReadStat[] {
  const d = db ?? getDb();
  return d.prepare(`
    SELECT
      file_path,
      COUNT(*) as read_count,
      COALESCE(SUM(payload_bytes), 0) as total_payload_bytes,
      MIN(timestamp_ms) as first_read_ms,
      MAX(timestamp_ms) as last_read_ms
    FROM file_reads
    WHERE session_id = ?
    GROUP BY file_path
    ORDER BY read_count DESC
  `).all(sessionId) as FileReadStat[];
}

export function getRepeatedFileReadCount(sessionId: string, threshold = 1, db?: Database.Database): number {
  const d = db ?? getDb();
  const row = d.prepare(`
    SELECT COUNT(*) as cnt FROM (
      SELECT file_path FROM file_reads
      WHERE session_id = ?
      GROUP BY file_path
      HAVING COUNT(*) > ?
    )
  `).get(sessionId, threshold) as { cnt: number };
  return row.cnt;
}

export interface FileWriteStat {
  file_path: string;
  write_count: number;
  tools_used: string;
  first_write_ms: number;
  last_write_ms: number;
}

export function getSessionFileWrites(sessionId: string, db?: Database.Database): FileWriteStat[] {
  const d = db ?? getDb();
  return d.prepare(`
    SELECT
      file_path,
      COUNT(*) as write_count,
      GROUP_CONCAT(DISTINCT tool_name) as tools_used,
      MIN(timestamp_ms) as first_write_ms,
      MAX(timestamp_ms) as last_write_ms
    FROM file_writes
    WHERE session_id = ?
    GROUP BY file_path
    ORDER BY write_count DESC
  `).all(sessionId) as FileWriteStat[];
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

/**
 * Aggregate token usage for one kind only (default 'observed'), so observed /
 * estimated / billed snapshots are never summed together. Pass kind=null to
 * sum across all kinds explicitly.
 */
export function getTokenAggregate(sinceMs?: number, kind: 'observed' | 'estimated' | 'billed' | null = 'observed'): TokenAggregate {
  const db = getDb();
  const clauses: string[] = [];
  const params: number[] = [];
  if (sinceMs) { clauses.push('timestamp_ms >= ?'); params.push(sinceMs); }
  if (kind) clauses.push(`(usage_kind = '${kind}' OR usage_kind IS NULL)`);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

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

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-6': 200000,
  'claude-sonnet-4-5-20250514': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'claude-fable-5-1': 200000,
  'claude-opus-5-5': 200000,
  'claude-sonnet-5-5': 200000,
  'claude-haiku-5-5': 200000,
};

const DEFAULT_CONTEXT_LIMIT = 200000;

export function estimateContextWindowUsage(sessionId: string, db?: Database.Database): number | null {
  const d = db ?? getDb();

  const session = d.prepare('SELECT model FROM sessions WHERE id = ?').get(sessionId) as { model: string | null } | undefined;
  if (!session) return null;

  const limit: number = (session.model ? MODEL_CONTEXT_LIMITS[session.model] : undefined) ?? DEFAULT_CONTEXT_LIMIT;

  const row = d.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as total_input,
      COALESCE(SUM(output_tokens), 0) as total_output,
      COALESCE(SUM(cache_write_tokens), 0) as total_cache_write
    FROM token_snapshots WHERE session_id = ?
  `).get(sessionId) as { total_input: number; total_output: number; total_cache_write: number };

  const used = row.total_input + row.total_output + row.total_cache_write;
  if (used === 0) return null;

  return Math.min(100, (used / limit) * 100);
}

export function getCacheReadRatio(sessionId?: string, db?: Database.Database): number | null {
  const d = db ?? getDb();
  const where = sessionId ? 'WHERE session_id = ?' : '';
  const params = sessionId ? [sessionId] : [];
  const row = d.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as total_input,
      COALESCE(SUM(cache_read_tokens), 0) as total_cache_read
    FROM token_snapshots ${where}
  `).get(...params) as { total_input: number; total_cache_read: number };
  const total = row.total_input + row.total_cache_read;
  if (total === 0) return null;
  return row.total_cache_read / total;
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
