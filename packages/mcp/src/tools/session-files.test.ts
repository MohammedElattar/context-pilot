import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb, closeDb, upsertSession, insertFileRead } from '@contextpilot/core';

vi.mock('node:fs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:fs')>();
  return { ...orig, existsSync: vi.fn(() => true) };
});

import { handleSessionFiles } from './session-files.js';

describe('handleSessionFiles', () => {
  const SESSION = 'mcp-sf-test-1';

  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM file_reads WHERE session_id LIKE ?").run('mcp-sf-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('mcp-sf-%');
    upsertSession({ id: SESSION, started_at: Date.now() });
  });

  afterEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM file_reads WHERE session_id LIKE ?").run('mcp-sf-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('mcp-sf-%');
    closeDb();
  });

  it('returns files read in session', async () => {
    insertFileRead({ session_id: SESSION, file_path: '/a.ts', timestamp_ms: 1000, payload_bytes: 100 });
    insertFileRead({ session_id: SESSION, file_path: '/b.ts', timestamp_ms: 2000, payload_bytes: 200 });

    const result = await handleSessionFiles({ session_id: SESSION });
    expect(result.total_files).toBe(2);
    expect(result.total_reads).toBe(2);
    expect(result.files).toHaveLength(2);
  });

  it('filters by min_reads', async () => {
    insertFileRead({ session_id: SESSION, file_path: '/a.ts', timestamp_ms: 1000 });
    insertFileRead({ session_id: SESSION, file_path: '/a.ts', timestamp_ms: 2000 });
    insertFileRead({ session_id: SESSION, file_path: '/b.ts', timestamp_ms: 3000 });

    const result = await handleSessionFiles({ session_id: SESSION, min_reads: 2 });
    expect(result.total_files).toBe(1);
    expect(result.files[0].file_path).toBe('/a.ts');
    expect(result.files[0].read_count).toBe(2);
  });

  it('returns empty for unknown session', async () => {
    const result = await handleSessionFiles({ session_id: 'nonexistent' });
    expect(result.files).toEqual([]);
  });
});
