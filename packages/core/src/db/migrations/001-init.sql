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
