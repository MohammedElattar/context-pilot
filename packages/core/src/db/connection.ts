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

const MIGRATION_003 = `
CREATE TABLE IF NOT EXISTS file_writes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  tool_name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_writes_session ON file_writes(session_id);
CREATE INDEX IF NOT EXISTS idx_file_writes_path ON file_writes(session_id, file_path);
`;

// Provenance columns are added idempotently in code (ensureColumn) because
// SQLite has no `ADD COLUMN IF NOT EXISTS` and tests share one DB file across
// parallel workers. The migration SQL keeps only the race-safe index.
const MIGRATION_004 = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id
  ON events(event_id) WHERE event_id IS NOT NULL;
`;

const MIGRATION_006 = `
CREATE TABLE IF NOT EXISTS benchmark_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  config TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  avg_duration_ms REAL NOT NULL,
  median_duration_ms REAL NOT NULL,
  total_output_chars INTEGER NOT NULL,
  success_rate REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_benchmark_started ON benchmark_runs(started_at);
`;

// usage_kind column added idempotently in code (ensureColumn). The backfill is
// idempotent via `WHERE usage_kind IS NULL`: existing rows become 'billed' when
// their source came from Caveman, else 'observed'.
const MIGRATION_005 = `
UPDATE token_snapshots
   SET usage_kind = CASE WHEN source LIKE 'caveman%' THEN 'billed' ELSE 'observed' END
 WHERE usage_kind IS NULL;

CREATE INDEX IF NOT EXISTS idx_token_kind ON token_snapshots(session_id, usage_kind);
`;

// Research Gateway cache (Slice 1). Content-addressed: body keyed by url_hash,
// evidence rows keyed by `${content_hash}:${section_index}` so identical content
// fetched from different URLs collapses to one evidence row (INSERT OR IGNORE).
const MIGRATION_007 = `
CREATE TABLE IF NOT EXISTS research_cache (
  url_hash TEXT PRIMARY KEY,
  normalized_url TEXT NOT NULL,
  final_url TEXT,
  content_hash TEXT,
  content_type TEXT,
  status INTEGER,
  body TEXT,
  body_bytes INTEGER,
  est_tokens INTEGER,
  fetched_at_ms INTEGER NOT NULL,
  ttl_ms INTEGER NOT NULL,
  source TEXT
);

CREATE TABLE IF NOT EXISTS research_evidence (
  evidence_id TEXT PRIMARY KEY,
  url_hash TEXT NOT NULL,
  content_hash TEXT,
  section_index INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  est_tokens INTEGER,
  rank_score REAL
);

CREATE INDEX IF NOT EXISTS idx_research_cache_content ON research_cache(content_hash);
CREATE INDEX IF NOT EXISTS idx_research_evidence_url ON research_evidence(url_hash);
`;

// Research investigation ledger (Slice 4): one row per gateway call, for the
// contextpilot_research_state summary and routed-vs-bypassed adoption metric.
const MIGRATION_008 = `
CREATE TABLE IF NOT EXISTS research_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  url_hash TEXT,
  normalized_url TEXT,
  focus TEXT,
  tool TEXT NOT NULL,
  cache_hit INTEGER,
  deduplicated INTEGER,
  est_tokens_in INTEGER,
  est_tokens_out INTEGER,
  est_tokens_saved INTEGER,
  ok INTEGER,
  code TEXT,
  timestamp_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_ledger_session ON research_ledger(session_id);
CREATE INDEX IF NOT EXISTS idx_research_ledger_time ON research_ledger(timestamp_ms);
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

/**
 * Add a column only if absent. Idempotent and safe under the
 * parallel-worker race: a concurrent duplicate ALTER is swallowed.
 */
function ensureColumn(database: Database.Database, table: string, column: string, type: string): void {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some(c => c.name === column)) return;
  try {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err) {
    if (!String((err as Error).message).includes('duplicate column name')) throw err;
  }
}

function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  // Idempotent column adds (see MIGRATION_004) — run before the index migration
  // so the unique index on event_id always has its column to build on.
  ensureColumn(database, 'events', 'event_id', 'TEXT');
  ensureColumn(database, 'events', 'source', 'TEXT');
  ensureColumn(database, 'events', 'confidence', 'REAL');
  ensureColumn(database, 'token_snapshots', 'usage_kind', 'TEXT');
  ensureColumn(database, 'file_reads', 'is_partial', 'INTEGER');
  ensureColumn(database, 'file_reads', 'fingerprint', 'TEXT');

  const applied = new Set(
    database.prepare('SELECT name FROM _migrations').all()
      .map((row: any) => row.name as string)
  );

  const migrations = [
    { name: '001-init', sql: MIGRATION_001 },
    { name: '002-file-reads', sql: MIGRATION_002 },
    { name: '003-file-writes', sql: MIGRATION_003 },
    { name: '004-event-provenance', sql: MIGRATION_004 },
    { name: '005-token-kind', sql: MIGRATION_005 },
    { name: '006-benchmark-runs', sql: MIGRATION_006 },
    { name: '007-research-cache', sql: MIGRATION_007 },
    { name: '008-research-ledger', sql: MIGRATION_008 },
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
