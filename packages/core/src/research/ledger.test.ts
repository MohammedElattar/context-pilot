import { describe, it, expect, afterEach } from 'vitest';
import { getDb, closeDb } from '../db/connection.js';
import { upsertSession, insertEvent } from '../db/telemetry-store.js';
import { recordResearch, getResearchSummary } from './ledger.js';

const SID = 'rl-session-1';

afterEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM research_ledger WHERE session_id = ?').run(SID);
  db.prepare('DELETE FROM events WHERE session_id = ?').run(SID);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(SID);
  closeDb();
});

describe('research ledger + summary', () => {
  it('aggregates routed calls, cache hits, savings and failures', () => {
    const db = getDb();
    upsertSession({ id: SID, started_at: Date.now() });
    recordResearch({ session_id: SID, tool: 'contextpilot_fetch', ok: true, cache_hit: false, est_tokens_in: 1000, est_tokens_out: 200, est_tokens_saved: 800 }, db);
    recordResearch({ session_id: SID, tool: 'contextpilot_fetch', ok: true, cache_hit: true, est_tokens_in: 1000, est_tokens_out: 200, est_tokens_saved: 800 }, db);
    recordResearch({ session_id: SID, tool: 'contextpilot_fetch', ok: false, code: 'ssrf_blocked' }, db);

    const s = getResearchSummary(SID, db);
    expect(s.routed_calls).toBe(3);
    expect(s.cache_hits).toBe(1);
    expect(s.failed_calls).toBe(1);
    expect(s.est_tokens_saved).toBe(1600);
    expect(s.cache_hit_rate).toBeCloseTo(1 / 3, 2);
  });

  it('computes routing adoption against native WebFetch/WebSearch calls', () => {
    const db = getDb();
    upsertSession({ id: SID, started_at: Date.now() });
    recordResearch({ session_id: SID, tool: 'contextpilot_fetch', ok: true }, db);
    recordResearch({ session_id: SID, tool: 'contextpilot_fetch', ok: true }, db);
    recordResearch({ session_id: SID, tool: 'contextpilot_fetch', ok: true }, db);
    insertEvent({ session_id: SID, event_type: 'PostToolUse', timestamp_ms: Date.now(), tool_name: 'WebFetch' });

    const s = getResearchSummary(SID, db);
    expect(s.routed_calls).toBe(3);
    expect(s.bypassed_native_calls).toBe(1);
    expect(s.routing_adoption_rate).toBeCloseTo(0.75, 2);
  });

  it('returns a null adoption rate when there was no research activity', () => {
    const db = getDb();
    upsertSession({ id: SID, started_at: Date.now() });
    const s = getResearchSummary(SID, db);
    expect(s.routed_calls).toBe(0);
    expect(s.routing_adoption_rate).toBeNull();
  });
});
