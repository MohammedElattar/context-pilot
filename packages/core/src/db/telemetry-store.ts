import { getDb } from './connection.js';

export interface SessionRecord {
  id: string;
  started_at: number;
  model?: string | null;
  cwd?: string | null;
  parent_session_id?: string | null;
}

export interface EventRecord {
  session_id: string;
  event_type: string;
  timestamp_ms: number;
  tool_name?: string | null;
  payload_bytes?: number | null;
  duration_ms?: number | null;
  /**
   * Stable dedup key. When set, a re-delivered identical event is inserted
   * once (INSERT OR IGNORE against a unique index). Leave undefined when no
   * stable key is available — the row then always inserts.
   */
  event_id?: string | null;
  /** Provenance of the record, e.g. 'observer'. */
  source?: string | null;
  /** 0..1 confidence that the event is directly observed. */
  confidence?: number | null;
}

export type UsageKind = 'observed' | 'estimated' | 'billed';

export interface TokenSnapshot {
  session_id: string;
  timestamp_ms: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  source: string;
  /** observed (directly measured), estimated (computed), or billed (provider). Defaults to 'observed'. */
  usage_kind?: UsageKind;
}

export function upsertSession(record: SessionRecord): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id, started_at, model, cwd, parent_session_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      model = COALESCE(excluded.model, model),
      cwd = COALESCE(excluded.cwd, cwd)
  `).run(
    record.id,
    record.started_at,
    record.model ?? null,
    record.cwd ?? null,
    record.parent_session_id ?? null,
  );
}

export function endSession(id: string, ended_at: number): void {
  const db = getDb();
  db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(ended_at, id);
}

export function insertEvent(record: EventRecord): void {
  const db = getDb();
  // INSERT OR IGNORE dedups on the unique event_id index; rows with a NULL
  // event_id are excluded from that index and so always insert.
  db.prepare(`
    INSERT OR IGNORE INTO events
      (session_id, event_type, timestamp_ms, tool_name, payload_bytes, duration_ms, event_id, source, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.session_id,
    record.event_type,
    record.timestamp_ms,
    record.tool_name ?? null,
    record.payload_bytes ?? null,
    record.duration_ms ?? null,
    record.event_id ?? null,
    record.source ?? null,
    record.confidence ?? null,
  );
}

export interface FileReadRecord {
  session_id: string;
  file_path: string;
  timestamp_ms: number;
  payload_bytes?: number | null;
  /** 1 when the read used offset/limit (a slice), 0 for a full read. */
  is_partial?: number | null;
  /** Hash of path+mtime+size (never file content); null when stat failed. */
  fingerprint?: string | null;
}

export function insertFileRead(record: FileReadRecord): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO file_reads (session_id, file_path, timestamp_ms, payload_bytes, is_partial, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    record.session_id,
    record.file_path,
    record.timestamp_ms,
    record.payload_bytes ?? null,
    record.is_partial ?? null,
    record.fingerprint ?? null,
  );
}

export interface FileWriteRecord {
  session_id: string;
  file_path: string;
  timestamp_ms: number;
  tool_name: string;
}

export function insertFileWrite(record: FileWriteRecord): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO file_writes (session_id, file_path, timestamp_ms, tool_name)
    VALUES (?, ?, ?, ?)
  `).run(
    record.session_id,
    record.file_path,
    record.timestamp_ms,
    record.tool_name,
  );
}

export function insertTokenSnapshot(record: TokenSnapshot): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO token_snapshots (session_id, timestamp_ms, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, source, usage_kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.session_id,
    record.timestamp_ms,
    record.input_tokens ?? null,
    record.output_tokens ?? null,
    record.cache_read_tokens ?? null,
    record.cache_write_tokens ?? null,
    record.source,
    record.usage_kind ?? 'observed',
  );
}

/**
 * Clear all ContextPilot telemetry so the dashboard starts fresh.
 * Only touches ContextPilot's own tables — never Caveman's data.
 * Returns the number of rows removed per table.
 */
export function resetTelemetry(): Record<string, number> {
  const db = getDb();
  const tables = [
    'events',
    'token_snapshots',
    'adapter_snapshots',
    'file_reads',
    'file_writes',
    'sessions',
  ];
  const removed: Record<string, number> = {};
  const clear = db.transaction(() => {
    for (const table of tables) {
      removed[table] = db.prepare(`DELETE FROM ${table}`).run().changes;
    }
  });
  clear();
  return removed;
}
