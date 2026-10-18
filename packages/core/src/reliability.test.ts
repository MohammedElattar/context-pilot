import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getSessionCost } from './cost/index.js';
import { estimateCost } from './cost/estimate.js';
import { analyzeFileReads } from './intelligence/file-reads.js';
import { computeContextHealth } from './intelligence/health.js';
import { profileMcpTools } from './mcp-profile/profile.js';
import { loadDeclarativePolicies, validateDeclarativePolicies } from './policy/declarative.js';
import { evaluateAllPolicies, buildPolicyContext } from './policy/engine.js';
import { compileDeclarativePolicy } from './policy/declarative.js';
import { DeclarativePolicySchema } from './policy/declarative.js';
import { openReadOnly, closeDb } from './db/connection.js';

// These tests assert the core constraint: ContextPilot never throws on bad or
// missing inputs — it fails open with empty/null results so Claude Code keeps
// working. "No invented telemetry": unavailable stays null, never fabricated.

describe('fail-open under failure injection', () => {
  afterEach(() => closeDb());

  it('getSessionCost on an unknown session yields nulls, never throws', () => {
    const c = getSessionCost('does-not-exist-xyz');
    expect(c.estimated).toBeNull();
    expect(c.billed).toBeNull();
  });

  it('estimateCost on an unknown model returns null, never 0', () => {
    expect(estimateCost({ input: 1_000_000 }, 'unknown-model')).toBeNull();
  });

  it('analyzeFileReads on an unknown session returns empty, never throws', () => {
    const r = analyzeFileReads('does-not-exist-xyz');
    expect(r.files).toEqual([]);
    expect(r.recommendations).toEqual([]);
  });

  it('computeContextHealth on an unknown session returns null score, confidence 0', () => {
    const h = computeContextHealth('does-not-exist-xyz');
    expect(h.score).toBeNull();
    expect(h.confidence).toBe(0);
  });

  it('profileMcpTools on an unknown session returns empty', () => {
    expect(profileMcpTools({ sessionId: 'does-not-exist-xyz' })).toEqual([]);
  });

  it('loadDeclarativePolicies on a missing file returns [] (fail-open)', () => {
    expect(loadDeclarativePolicies('/nope/does/not/exist.json')).toEqual([]);
  });

  it('loadDeclarativePolicies on corrupt JSON returns [] (fail-open)', () => {
    const f = join(tmpdir(), `cp-bad-policies-${process.pid}.json`);
    writeFileSync(f, '{ this is not json ');
    try {
      expect(loadDeclarativePolicies(f)).toEqual([]);
    } finally {
      rmSync(f, { force: true });
    }
  });

  it('validateDeclarativePolicies rejects garbage without throwing', () => {
    expect(validateDeclarativePolicies(null).ok).toBe(false);
    expect(validateDeclarativePolicies('garbage').ok).toBe(false);
    expect(validateDeclarativePolicies({ policies: 'not-an-array' }).ok).toBe(false);
  });

  it('a declarative policy with unavailable metric data does not trigger', () => {
    const decl = DeclarativePolicySchema.parse({
      id: 'p', name: 'p', metric: 'context_window_used_percent', operator: 'gte', value: 50, action: 'x',
    });
    const results = evaluateAllPolicies(buildPolicyContext({}), [compileDeclarativePolicy(decl)]);
    expect(results.find(r => r.id === 'p')!.triggered).toBe(false);
  });

  it('a corrupt DB file surfaces an error that the read-only wrapper pattern swallows', () => {
    const f = join(tmpdir(), `cp-corrupt-${process.pid}.db`);
    writeFileSync(f, 'this is not a sqlite database');
    try {
      // Mirrors the queryDb fail-open pattern used by MCP tools and the dashboard.
      const safe = <T>(fn: () => T, fallback: T): T => {
        try { return fn(); } catch { return fallback; }
      };
      const rows = safe(() => {
        const db = openReadOnly(f);
        const r = db.prepare('SELECT 1').all();
        db.close();
        return r;
      }, []);
      expect(rows).toEqual([]);
    } finally {
      rmSync(f, { force: true });
    }
  });
});
