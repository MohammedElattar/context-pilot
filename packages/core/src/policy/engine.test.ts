import { describe, it, expect } from 'vitest';
import { evaluatePolicies, getTriggeredPolicies, buildPolicyContext } from './engine.js';

describe('policy engine', () => {
  it('returns results for all policies', () => {
    const ctx = buildPolicyContext({});
    const results = evaluatePolicies(ctx);
    expect(results.length).toBeGreaterThanOrEqual(5);
    results.forEach(r => {
      expect(r.id).toBeTruthy();
      expect(r.name).toBeTruthy();
    });
  });

  it('triggers high-context-pressure when above 80%', () => {
    const ctx = buildPolicyContext({ contextWindowUsedPercent: 90 });
    const triggered = getTriggeredPolicies(ctx);
    expect(triggered.some(r => r.id === 'high-context-pressure')).toBe(true);
  });

  it('does not trigger high-context-pressure when below 80%', () => {
    const ctx = buildPolicyContext({ contextWindowUsedPercent: 50 });
    const triggered = getTriggeredPolicies(ctx);
    expect(triggered.some(r => r.id === 'high-context-pressure')).toBe(false);
  });

  it('triggers low-cache-hit-rate when below 30%', () => {
    const ctx = buildPolicyContext({ cacheReadRatio: 0.1 });
    const triggered = getTriggeredPolicies(ctx);
    expect(triggered.some(r => r.id === 'low-cache-hit-rate')).toBe(true);
  });

  it('triggers excessive-tool-calls when over 50', () => {
    const ctx = buildPolicyContext({ toolCallCount: 80 });
    const triggered = getTriggeredPolicies(ctx);
    expect(triggered.some(r => r.id === 'excessive-tool-calls')).toBe(true);
  });

  it('triggers caveman-output-disabled when caveman enabled but not compressing', () => {
    const ctx = buildPolicyContext({ cavemanEnabled: true, cavemanCompressingOutput: false });
    const triggered = getTriggeredPolicies(ctx);
    expect(triggered.some(r => r.id === 'caveman-output-disabled')).toBe(true);
  });

  it('does not trigger caveman-output-disabled when compression active', () => {
    const ctx = buildPolicyContext({ cavemanEnabled: true, cavemanCompressingOutput: true });
    const triggered = getTriggeredPolicies(ctx);
    expect(triggered.some(r => r.id === 'caveman-output-disabled')).toBe(false);
  });

  it('returns no triggers for a healthy default context', () => {
    const ctx = buildPolicyContext({});
    const triggered = getTriggeredPolicies(ctx);
    expect(triggered.length).toBe(0);
  });
});
