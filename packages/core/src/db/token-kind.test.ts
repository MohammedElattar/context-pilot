import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from './connection.js';
import { insertTokenSnapshot, upsertSession } from './telemetry-store.js';
import { getTokenAggregate } from './telemetry-query.js';

describe('usage_kind on token_snapshots (migration 005)', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM token_snapshots WHERE session_id LIKE ?").run('tk-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('tk-%');
    upsertSession({ id: 'tk-1', started_at: Date.now() });
  });

  afterEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM token_snapshots WHERE session_id LIKE ?").run('tk-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('tk-%');
    closeDb();
  });

  it('migration 005 added usage_kind column', () => {
    const cols = (getDb().prepare('PRAGMA table_info(token_snapshots)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain('usage_kind');
  });

  it('defaults new snapshots to observed', () => {
    insertTokenSnapshot({ session_id: 'tk-1', timestamp_ms: 1, input_tokens: 100, source: 'test' });
    const row = getDb()
      .prepare("SELECT usage_kind FROM token_snapshots WHERE session_id = 'tk-1'")
      .get() as { usage_kind: string };
    expect(row.usage_kind).toBe('observed');
  });

  it('aggregate defaults to observed only — estimated/billed never mixed in', () => {
    insertTokenSnapshot({ session_id: 'tk-1', timestamp_ms: 1, input_tokens: 100, source: 'obs', usage_kind: 'observed' });
    insertTokenSnapshot({ session_id: 'tk-1', timestamp_ms: 2, input_tokens: 999, source: 'est', usage_kind: 'estimated' });
    insertTokenSnapshot({ session_id: 'tk-1', timestamp_ms: 3, input_tokens: 500, source: 'caveman', usage_kind: 'billed' });

    const observed = getTokenAggregate();
    expect(observed.total_input).toBe(100);

    const all = getTokenAggregate(undefined, null);
    expect(all.total_input).toBe(1599);

    const billed = getTokenAggregate(undefined, 'billed');
    expect(billed.total_input).toBe(500);
  });
});
