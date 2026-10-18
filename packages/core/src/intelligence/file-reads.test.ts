import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../db/connection.js';
import { insertFileRead, insertEvent, upsertSession } from '../db/telemetry-store.js';
import { analyzeFileReads } from './file-reads.js';

describe('analyzeFileReads', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM file_reads WHERE session_id LIKE ?").run('fri-%');
    db.prepare("DELETE FROM events WHERE session_id LIKE ?").run('fri-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('fri-%');
    upsertSession({ id: 'fri-1', started_at: Date.now() });
  });

  afterEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM file_reads WHERE session_id LIKE ?").run('fri-%');
    db.prepare("DELETE FROM events WHERE session_id LIKE ?").run('fri-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('fri-%');
    closeDb();
  });

  it('flags an unchanged full re-read with high confidence (no compaction)', () => {
    insertFileRead({ session_id: 'fri-1', file_path: '/a.ts', timestamp_ms: 1000, is_partial: 0, fingerprint: 'fp-a' });
    insertFileRead({ session_id: 'fri-1', file_path: '/a.ts', timestamp_ms: 2000, is_partial: 0, fingerprint: 'fp-a' });

    const r = analyzeFileReads('fri-1');
    const a = r.files.find(f => f.file_path === '/a.ts')!;
    expect(a.read_count).toBe(2);
    expect(a.unchanged_repeats).toBe(1);
    expect(a.had_full_read).toBe(true);
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0].kind).toBe('reuse-unchanged-read');
    expect(r.recommendations[0].confidence).toBeCloseTo(0.9);
  });

  it('does not flag a re-read whose fingerprint changed (file edited)', () => {
    insertFileRead({ session_id: 'fri-1', file_path: '/a.ts', timestamp_ms: 1000, is_partial: 0, fingerprint: 'fp-1' });
    insertFileRead({ session_id: 'fri-1', file_path: '/a.ts', timestamp_ms: 2000, is_partial: 0, fingerprint: 'fp-2' });

    const r = analyzeFileReads('fri-1');
    expect(r.files[0].unchanged_repeats).toBe(0);
    expect(r.recommendations).toHaveLength(0);
  });

  it('lowers confidence when the re-read spans a compaction boundary', () => {
    insertFileRead({ session_id: 'fri-1', file_path: '/a.ts', timestamp_ms: 1000, is_partial: 0, fingerprint: 'fp-a' });
    insertFileRead({ session_id: 'fri-1', file_path: '/a.ts', timestamp_ms: 1500, is_partial: 0, fingerprint: 'fp-a' });
    insertEvent({ session_id: 'fri-1', event_type: 'PreCompact', timestamp_ms: 3000 });

    const r = analyzeFileReads('fri-1');
    expect(r.last_compaction_ms).toBe(3000);
    // both reads before compaction → last read is before boundary → confidence 0.5
    expect(r.recommendations[0].confidence).toBeCloseTo(0.5);
  });

  it('marks files read only in slices as partial_only', () => {
    insertFileRead({ session_id: 'fri-1', file_path: '/big.ts', timestamp_ms: 1000, is_partial: 1, fingerprint: 'fp-b' });
    insertFileRead({ session_id: 'fri-1', file_path: '/big.ts', timestamp_ms: 2000, is_partial: 1, fingerprint: 'fp-b' });

    const r = analyzeFileReads('fri-1');
    const b = r.files.find(f => f.file_path === '/big.ts')!;
    expect(b.partial_only).toBe(true);
    expect(b.had_full_read).toBe(false);
    // partial-only repeats are not recommended for reuse (no full read to reuse)
    expect(r.recommendations).toHaveLength(0);
  });

  it('counts reads after the compaction boundary', () => {
    insertFileRead({ session_id: 'fri-1', file_path: '/a.ts', timestamp_ms: 1000, is_partial: 0, fingerprint: 'fp-a' });
    insertEvent({ session_id: 'fri-1', event_type: 'PreCompact', timestamp_ms: 2000 });
    insertFileRead({ session_id: 'fri-1', file_path: '/a.ts', timestamp_ms: 3000, is_partial: 0, fingerprint: 'fp-a' });

    const r = analyzeFileReads('fri-1');
    expect(r.files[0].reads_after_compaction).toBe(1);
    // last read is after boundary → high confidence
    expect(r.recommendations[0].confidence).toBeCloseTo(0.9);
  });
});
