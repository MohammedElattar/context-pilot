import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from './connection.js';
import { insertEvent, upsertSession } from './telemetry-store.js';

function countEvents(eventId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS n FROM events WHERE event_id = ?').get(eventId) as { n: number };
  return row.n;
}

describe('event provenance + dedup (migration 004)', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM events WHERE session_id LIKE ?").run('ep-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('ep-%');
    upsertSession({ id: 'ep-session-1', started_at: Date.now() });
  });

  afterEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM events WHERE session_id LIKE ?").run('ep-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('ep-%');
    closeDb();
  });

  it('migration 004 added provenance columns', () => {
    const cols = (getDb().prepare('PRAGMA table_info(events)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain('event_id');
    expect(cols).toContain('source');
    expect(cols).toContain('confidence');
  });

  it('dedups a re-delivered event with the same event_id', () => {
    const rec = {
      session_id: 'ep-session-1',
      event_type: 'PostToolUse',
      timestamp_ms: 1000,
      tool_name: 'Read',
      event_id: 'PostToolUse:tu_abc',
      source: 'observer',
      confidence: 1,
    };
    insertEvent(rec);
    insertEvent({ ...rec, timestamp_ms: 2000 }); // re-delivery, different clock
    expect(countEvents('PostToolUse:tu_abc')).toBe(1);
  });

  it('persists source and confidence', () => {
    insertEvent({
      session_id: 'ep-session-1',
      event_type: 'PostToolUse',
      timestamp_ms: 1000,
      event_id: 'PostToolUse:tu_xyz',
      source: 'observer',
      confidence: 1,
    });
    const row = getDb()
      .prepare('SELECT source, confidence FROM events WHERE event_id = ?')
      .get('PostToolUse:tu_xyz') as { source: string; confidence: number };
    expect(row.source).toBe('observer');
    expect(row.confidence).toBe(1);
  });

  it('events with a NULL event_id always insert (no dedup key)', () => {
    const rec = { session_id: 'ep-session-1', event_type: 'Stop', timestamp_ms: 1000, source: 'observer', confidence: 1 };
    insertEvent(rec);
    insertEvent({ ...rec, timestamp_ms: 2000 });
    const row = getDb()
      .prepare("SELECT COUNT(*) AS n FROM events WHERE session_id = 'ep-session-1' AND event_type = 'Stop'")
      .get() as { n: number };
    expect(row.n).toBe(2);
  });

  it('distinct event_ids both insert', () => {
    const base = { session_id: 'ep-session-1', event_type: 'PostToolUse', timestamp_ms: 1000, source: 'observer', confidence: 1 };
    insertEvent({ ...base, event_id: 'PostToolUse:tu_1' });
    insertEvent({ ...base, event_id: 'PostToolUse:tu_2' });
    expect(countEvents('PostToolUse:tu_1')).toBe(1);
    expect(countEvents('PostToolUse:tu_2')).toBe(1);
  });
});
