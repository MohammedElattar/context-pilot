import { describe, it, expect } from 'vitest';
import { compileDeclarativePolicy, validateDeclarativePolicies, DeclarativePolicySchema } from './declarative.js';
import { evaluateAllPolicies, buildPolicyContext } from './engine.js';

describe('declarative policies', () => {
  const decl = DeclarativePolicySchema.parse({
    id: 'big-context',
    name: 'Context above 90%',
    metric: 'context_window_used_percent',
    operator: 'gte',
    value: 90,
    severity: 'critical',
    action: 'Compact now.',
    confidence: 0.8,
  });

  it('triggers when the metric satisfies the operator', () => {
    const p = compileDeclarativePolicy(decl);
    const r = p.evaluate(buildPolicyContext({ contextWindowUsedPercent: 95 }));
    expect(r.triggered).toBe(true);
    expect(r.severity).toBe('critical');
    expect(r.confidence).toBe(0.8);
  });

  it('does not trigger below the threshold', () => {
    const p = compileDeclarativePolicy(decl);
    const r = p.evaluate(buildPolicyContext({ contextWindowUsedPercent: 50 }));
    expect(r.triggered).toBe(false);
    expect(r.severity).toBe('info');
  });

  it('does not trigger on unavailable metric data (never guesses)', () => {
    const p = compileDeclarativePolicy(decl);
    const r = p.evaluate(buildPolicyContext({})); // contextWindowUsedPercent → null
    expect(r.triggered).toBe(false);
    expect(r.reason).toContain('unavailable');
  });

  it('respects enabled:false', () => {
    const disabled = DeclarativePolicySchema.parse({ ...decl, id: 'off', enabled: false });
    const p = compileDeclarativePolicy(disabled);
    expect(p.evaluate(buildPolicyContext({ contextWindowUsedPercent: 99 })).triggered).toBe(false);
  });

  it('evaluateAllPolicies merges code + declarative', () => {
    const results = evaluateAllPolicies(buildPolicyContext({ contextWindowUsedPercent: 95 }), [compileDeclarativePolicy(decl)]);
    expect(results.some(r => r.id === 'big-context' && r.triggered)).toBe(true);
    // a built-in policy id is still present
    expect(results.some(r => r.id === 'high-context-pressure')).toBe(true);
  });

  it('validateDeclarativePolicies flags duplicate ids and bad shapes', () => {
    const dup = validateDeclarativePolicies({ policies: [
      { id: 'x', name: 'a', metric: 'tool_call_count', operator: 'gt', value: 10, action: 'a' },
      { id: 'x', name: 'b', metric: 'tool_call_count', operator: 'gt', value: 20, action: 'b' },
    ]});
    expect(dup.ok).toBe(false);
    expect(dup.errors.some(e => e.includes('duplicate'))).toBe(true);

    const bad = validateDeclarativePolicies({ policies: [{ id: 'y', name: 'n', metric: 'nope', operator: 'gt', value: 1, action: 'a' }] });
    expect(bad.ok).toBe(false);

    const good = validateDeclarativePolicies({ policies: [{ id: 'z', name: 'n', metric: 'cache_read_ratio', operator: 'lt', value: 0.3, action: 'a' }] });
    expect(good.ok).toBe(true);
    expect(good.count).toBe(1);
  });
});
