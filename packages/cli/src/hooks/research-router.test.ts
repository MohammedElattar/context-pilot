import { describe, it, expect } from 'vitest';
import { routeDecision, STRICT_REASON } from './research-router-logic.js';

describe('strict research router logic', () => {
  it('denies native WebFetch and WebSearch when strict (no escape)', () => {
    expect(routeDecision('WebFetch', false)?.decision).toBe('deny');
    expect(routeDecision('WebSearch', false)?.decision).toBe('deny');
    expect(routeDecision('WebFetch', false)?.reason).toContain('contextpilot_fetch');
  });

  it('allows (stays silent) under the CONTEXTPILOT_ALLOW_NATIVE escape', () => {
    expect(routeDecision('WebFetch', true)).toBeNull();
    expect(routeDecision('WebSearch', true)).toBeNull();
  });

  it('never touches other tools', () => {
    expect(routeDecision('Read', false)).toBeNull();
    expect(routeDecision('Bash', false)).toBeNull();
    expect(routeDecision(undefined, false)).toBeNull();
  });

  it('reason names the tool and the escape', () => {
    expect(STRICT_REASON).toContain('CONTEXTPILOT_ALLOW_NATIVE');
  });
});
