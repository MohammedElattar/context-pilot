import { describe, it, expect } from 'vitest';
import { estimateCost } from './estimate.js';
import { getModelPricing } from './pricing.js';

describe('estimateCost', () => {
  it('prices input and output for a known model', () => {
    // opus-5-5: $4/MTok in, $20/MTok out
    const est = estimateCost({ input: 1_000_000, output: 1_000_000 }, 'claude-opus-5-5');
    expect(est).not.toBeNull();
    expect(est!.breakdown.input).toBeCloseTo(4, 10);
    expect(est!.breakdown.output).toBeCloseTo(20, 10);
    expect(est!.usd).toBeCloseTo(24, 10);
    expect(est!.kind).toBe('estimated');
    expect(est!.partial).toBe(false);
  });

  it('prices cache-read tokens when a rate is published', () => {
    // opus-5-5 cache read: $0.20/MTok
    const est = estimateCost({ cacheRead: 2_000_000 }, 'claude-opus-5-5');
    expect(est!.breakdown.cacheRead).toBeCloseTo(0.4, 10);
    expect(est!.usd).toBeCloseTo(0.4, 10);
    expect(est!.partial).toBe(false);
  });

  it('marks cache-write tokens unpriced (no rate) as partial, not zero-inflated', () => {
    const est = estimateCost({ input: 1_000_000, cacheWrite: 500_000 }, 'claude-opus-5-5');
    expect(est!.breakdown.input).toBeCloseTo(4, 10);
    expect(est!.breakdown.cacheWrite).toBe(0);
    expect(est!.unpriced.cacheWrite).toBe(500_000);
    expect(est!.partial).toBe(true);
  });

  it('returns null for an unknown model (unavailable, never 0)', () => {
    expect(estimateCost({ input: 1_000_000 }, 'gpt-4o')).toBeNull();
    expect(estimateCost({ input: 1_000_000 }, null)).toBeNull();
    expect(estimateCost({ input: 1_000_000 }, undefined)).toBeNull();
  });

  it('returns a zero-cost estimate (not null) for zero tokens on a known model', () => {
    const est = estimateCost({ input: 0, output: 0 }, 'claude-sonnet-5-5');
    expect(est).not.toBeNull();
    expect(est!.usd).toBe(0);
    expect(est!.partial).toBe(false);
    expect(est!.kind).toBe('estimated');
  });

  it('breakdown components sum to usd', () => {
    const est = estimateCost(
      { input: 123_456, output: 65_432, cacheRead: 10_000 },
      'claude-opus-5-5',
    );
    const sum = est!.breakdown.input + est!.breakdown.output + est!.breakdown.cacheRead + est!.breakdown.cacheWrite;
    expect(est!.usd).toBeCloseTo(sum, 12);
  });

  it('matches a model id carrying a trailing date snapshot', () => {
    const exact = getModelPricing('claude-opus-5-5');
    const dated = getModelPricing('claude-opus-5-5-20260401');
    expect(dated).toBe(exact);
  });

  it('negative token counts are clamped to zero', () => {
    const est = estimateCost({ input: -100, output: 1_000_000 }, 'claude-opus-5-5');
    expect(est!.breakdown.input).toBe(0);
    expect(est!.breakdown.output).toBeCloseTo(20, 10);
  });
});
