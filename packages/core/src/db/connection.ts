import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from '../config/paths.js';

let db: Database.Database | null = null;

const MIGRATION_002 = `
CREATE TABLE IF NOT EXISTS file_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  payload_bytes INTEGER
);

CREATE INDEX IF NOT EXISTS idx_file_reads_session ON file_reads(session_id);
CREATE INDEX IF NOT EXISTS idx_file_reads_path ON file_reads(session_id, file_path);
`;

const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  model TEXT,
  cwd TEXT,
  parent_session_id TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  tool_name TEXT,
  payload_bytes INTEGER,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS token_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adapter_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adapter_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_token_session ON token_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_adapter_time ON adapter_snapshots(timestamp_ms);
`;

export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(dirname(paths.contextPilot.db), { recursive: true });

  db = new Database(paths.contextPilot.db);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  return db;
}

function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    database.prepare('SELECT name FROM _migrations').all()
      .map((row: any) => row.name as string)
  );

  const migrations = [
    { name: '001-init', sql: MIGRATION_001 },
    { name: '002-file-reads', sql: MIGRATION_002 },
  ];

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;

    database.exec(migration.sql);
    database.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
      migration.name,
      Date.now()
    );
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function openReadOnly(path: string): Database.Database {
  return new Database(path, { readonly: true, fileMustExist: true });
}
