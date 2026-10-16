import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from './connection.js';
import { insertFileRead } from './telemetry-store.js';
import { getSessionFileReads, getRepeatedFileReadCount } from './telemetry-query.js';
import { upsertSession } from './telemetry-store.js';

describe('file read tracking', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM file_reads WHERE session_id LIKE ?").run('fr-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('fr-%');
    upsertSession({ id: 'fr-session-1', started_at: Date.now() });
  });

  afterEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM file_reads WHERE session_id LIKE ?").run('fr-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('fr-%');
    closeDb();
  });

  it('records and retrieves file reads', () => {
    insertFileRead({ session_id: 'fr-session-1', file_path: '/a.ts', timestamp_ms: 1000, payload_bytes: 100 });
    insertFileRead({ session_id: 'fr-session-1', file_path: '/b.ts', timestamp_ms: 2000, payload_bytes: 200 });

    const reads = getSessionFileReads('fr-session-1');
    expect(reads.length).toBe(2);
    expect(reads[0].read_count).toBe(1);
  });

  it('groups repeated reads by file_path', () => {
    insertFileRead({ session_id: 'fr-session-1', file_path: '/a.ts', timestamp_ms: 1000, payload_bytes: 100 });
    insertFileRead({ session_id: 'fr-session-1', file_path: '/a.ts', timestamp_ms: 2000, payload_bytes: 100 });
    insertFileRead({ session_id: 'fr-session-1', file_path: '/a.ts', timestamp_ms: 3000, payload_bytes: 100 });

    const reads = getSessionFileReads('fr-session-1');
    expect(reads.length).toBe(1);
    expect(reads[0].file_path).toBe('/a.ts');
    expect(reads[0].read_count).toBe(3);
    expect(reads[0].total_payload_bytes).toBe(300);
  });

  it('orders by read_count descending', () => {
    insertFileRead({ session_id: 'fr-session-1', file_path: '/a.ts', timestamp_ms: 1000 });
    insertFileRead({ session_id: 'fr-session-1', file_path: '/b.ts', timestamp_ms: 2000 });
    insertFileRead({ session_id: 'fr-session-1', file_path: '/b.ts', timestamp_ms: 3000 });

    const reads = getSessionFileReads('fr-session-1');
    expect(reads[0].file_path).toBe('/b.ts');
    expect(reads[0].read_count).toBe(2);
  });

  it('counts repeated reads above threshold', () => {
    insertFileRead({ session_id: 'fr-session-1', file_path: '/a.ts', timestamp_ms: 1000 });
    insertFileRead({ session_id: 'fr-session-1', file_path: '/a.ts', timestamp_ms: 2000 });
    insertFileRead({ session_id: 'fr-session-1', file_path: '/b.ts', timestamp_ms: 3000 });

    expect(getRepeatedFileReadCount('fr-session-1', 1)).toBe(1);
    expect(getRepeatedFileReadCount('fr-session-1', 2)).toBe(0);
  });

  it('returns empty for unknown session', () => {
    expect(getSessionFileReads('nonexistent')).toEqual([]);
    expect(getRepeatedFileReadCount('nonexistent')).toBe(0);
  });
});
