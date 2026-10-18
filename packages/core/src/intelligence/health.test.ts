import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../db/connection.js';
import { insertEvent, insertFileRead, insertTokenSnapshot, upsertSession } from '../db/telemetry-store.js';
import { computeContextHealth } from './health.js';

describe('computeContextHealth', () => {
  beforeEach(() => {
    const db = getDb();
    for (const t of ['events', 'file_reads', 'token_snapshots']) {
      db.prepare(`DELETE FROM ${t} WHERE session_id LIKE ?`).run('h-%');
    }
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('h-%');
  });

  afterEach(() => {
    const db = getDb();
    for (const t of ['events', 'file_reads', 'token_snapshots']) {
      db.prepare(`DELETE FROM ${t} WHERE session_id LIKE ?`).run('h-%');
    }
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('h-%');
    closeDb();
  });

  it('reports null score and zero confidence for an empty session', () => {
    upsertSession({ id: 'h-empty', started_at: Date.now() });
    const h = computeContextHealth('h-empty');
    expect(h.score).toBeNull();
    expect(h.confidence).toBe(0);
    expect(h.missing_data.length).toBe(h.factors.length);
  });

  it('scores a clean session high with partial confidence (events only)', () => {
    upsertSession({ id: 'h-clean', started_at: Date.now() });
    for (let i = 0; i < 5; i++) {
      insertEvent({ session_id: 'h-clean', event_type: 'PostToolUse', timestamp_ms: i, tool_name: 'Read', event_id: `PostToolUse:h${i}` });
    }
    const h = computeContextHealth('h-clean');
    expect(h.score).not.toBeNull();
    expect(h.score!).toBeGreaterThan(70);
    expect(h.confidence).toBeGreaterThan(0);
    expect(h.confidence).toBeLessThan(1);
  });

  it('penalizes a high tool-failure rate', () => {
    upsertSession({ id: 'h-fail', started_at: Date.now() });
    for (let i = 0; i < 5; i++) insertEvent({ session_id: 'h-fail', event_type: 'PostToolUseFailure', timestamp_ms: i, tool_name: 'Bash', event_id: `f${i}` });
    insertEvent({ session_id: 'h-fail', event_type: 'PostToolUse', timestamp_ms: 99, tool_name: 'Bash', event_id: 'ok1' });

    const h = computeContextHealth('h-fail');
    const retry = h.factors.find(f => f.key === 'retry_rate')!;
    expect(retry.status).toBe('critical');
    expect(retry.value).toBeCloseTo(5 / 6, 5);
  });

  it('rises in confidence as more signal sources appear', () => {
    upsertSession({ id: 'h-full', started_at: Date.now(), model: 'claude-opus-5-5' });
    insertEvent({ session_id: 'h-full', event_type: 'PostToolUse', timestamp_ms: 1, tool_name: 'Read', event_id: 'e1' });
    insertFileRead({ session_id: 'h-full', file_path: '/a.ts', timestamp_ms: 1, is_partial: 0, fingerprint: 'fp' });
    insertTokenSnapshot({ session_id: 'h-full', timestamp_ms: 1, input_tokens: 1000, output_tokens: 500, cache_read_tokens: 2000, source: 'obs' });

    const h = computeContextHealth('h-full');
    const completeness = h.factors.find(f => f.key === 'telemetry_completeness')!;
    expect(completeness.value).toBe(3);
    expect(h.confidence).toBe(1); // every factor now has data
    expect(h.missing_data).toHaveLength(0);
  });

  it('flags redundant unchanged reads in its factor', () => {
    upsertSession({ id: 'h-rr', started_at: Date.now() });
    insertEvent({ session_id: 'h-rr', event_type: 'PostToolUse', timestamp_ms: 1, tool_name: 'Read', event_id: 'e1' });
    insertFileRead({ session_id: 'h-rr', file_path: '/a.ts', timestamp_ms: 1, is_partial: 0, fingerprint: 'same' });
    insertFileRead({ session_id: 'h-rr', file_path: '/a.ts', timestamp_ms: 2, is_partial: 0, fingerprint: 'same' });
    insertFileRead({ session_id: 'h-rr', file_path: '/a.ts', timestamp_ms: 3, is_partial: 0, fingerprint: 'same' });

    const h = computeContextHealth('h-rr');
    const rr = h.factors.find(f => f.key === 'redundant_reads')!;
    expect(rr.value).toBe(2);
    expect(rr.subscore).toBeCloseTo(1 / 3, 5);
  });
});
