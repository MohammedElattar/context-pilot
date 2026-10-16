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
}

export interface TokenSnapshot {
  session_id: string;
  timestamp_ms: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  source: string;
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
  db.prepare(`
    INSERT INTO events (session_id, event_type, timestamp_ms, tool_name, payload_bytes, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    record.session_id,
    record.event_type,
    record.timestamp_ms,
    record.tool_name ?? null,
    record.payload_bytes ?? null,
    record.duration_ms ?? null,
  );
}

export interface FileReadRecord {
  session_id: string;
  file_path: string;
  timestamp_ms: number;
  payload_bytes?: number | null;
}

export function insertFileRead(record: FileReadRecord): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO file_reads (session_id, file_path, timestamp_ms, payload_bytes)
    VALUES (?, ?, ?, ?)
  `).run(
    record.session_id,
    record.file_path,
    record.timestamp_ms,
    record.payload_bytes ?? null,
  );
}

export function insertTokenSnapshot(record: TokenSnapshot): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO token_snapshots (session_id, timestamp_ms, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.session_id,
    record.timestamp_ms,
    record.input_tokens ?? null,
    record.output_tokens ?? null,
    record.cache_read_tokens ?? null,
    record.cache_write_tokens ?? null,
    record.source,
  );
}
