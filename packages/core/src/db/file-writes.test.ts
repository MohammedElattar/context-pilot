import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from './connection.js';
import { insertFileWrite } from './telemetry-store.js';
import { getSessionFileWrites } from './telemetry-query.js';
import { upsertSession } from './telemetry-store.js';

describe('file write tracking', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM file_writes WHERE session_id LIKE ?").run('fw-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('fw-%');
    upsertSession({ id: 'fw-session-1', started_at: Date.now() });
  });

  afterEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM file_writes WHERE session_id LIKE ?").run('fw-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('fw-%');
    closeDb();
  });

  it('records and retrieves file writes', () => {
    insertFileWrite({ session_id: 'fw-session-1', file_path: '/a.ts', timestamp_ms: 1000, tool_name: 'Write' });
    insertFileWrite({ session_id: 'fw-session-1', file_path: '/b.ts', timestamp_ms: 2000, tool_name: 'Edit' });

    const writes = getSessionFileWrites('fw-session-1');
    expect(writes.length).toBe(2);
    expect(writes[0].write_count).toBe(1);
  });

  it('groups repeated writes by file_path', () => {
    insertFileWrite({ session_id: 'fw-session-1', file_path: '/a.ts', timestamp_ms: 1000, tool_name: 'Write' });
    insertFileWrite({ session_id: 'fw-session-1', file_path: '/a.ts', timestamp_ms: 2000, tool_name: 'Edit' });
    insertFileWrite({ session_id: 'fw-session-1', file_path: '/a.ts', timestamp_ms: 3000, tool_name: 'Edit' });

    const writes = getSessionFileWrites('fw-session-1');
    expect(writes.length).toBe(1);
    expect(writes[0].file_path).toBe('/a.ts');
    expect(writes[0].write_count).toBe(3);
    expect(writes[0].tools_used).toContain('Write');
    expect(writes[0].tools_used).toContain('Edit');
  });

  it('orders by write_count descending', () => {
    insertFileWrite({ session_id: 'fw-session-1', file_path: '/a.ts', timestamp_ms: 1000, tool_name: 'Write' });
    insertFileWrite({ session_id: 'fw-session-1', file_path: '/b.ts', timestamp_ms: 2000, tool_name: 'Edit' });
    insertFileWrite({ session_id: 'fw-session-1', file_path: '/b.ts', timestamp_ms: 3000, tool_name: 'Edit' });

    const writes = getSessionFileWrites('fw-session-1');
    expect(writes[0].file_path).toBe('/b.ts');
    expect(writes[0].write_count).toBe(2);
  });

  it('returns empty for unknown session', () => {
    expect(getSessionFileWrites('nonexistent')).toEqual([]);
  });
});
