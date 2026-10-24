import { describe, it, expect } from 'vitest';
import { routeDecision, STRICT_REASON, type RouterEnv } from './research-router-logic.js';

const withBackend: RouterEnv = { allowNative: false, searxngUrl: 'http://127.0.0.1:8080' };
const noBackend: RouterEnv = { allowNative: false };
const escaped: RouterEnv = { allowNative: true, searxngUrl: 'http://127.0.0.1:8080' };

describe('strict research router logic', () => {
  it('denies WebFetch when strict (always — gateway can fetch any URL)', () => {
    expect(routeDecision('WebFetch', noBackend)?.decision).toBe('deny');
    expect(routeDecision('WebFetch', withBackend)?.decision).toBe('deny');
    expect(routeDecision('WebFetch', withBackend)?.reason).toContain('contextpilot_fetch');
  });

  it('denies WebSearch only when a search backend is configured', () => {
    expect(routeDecision('WebSearch', withBackend)?.decision).toBe('deny');
    expect(routeDecision('WebSearch', { allowNative: false, braveKey: 'key123' })?.decision).toBe('deny');
  });

  it('allows WebSearch through when no search backend is configured (deadlock prevention)', () => {
    expect(routeDecision('WebSearch', noBackend)).toBeNull();
  });

  it('allows everything under the CONTEXTPILOT_ALLOW_NATIVE escape', () => {
    expect(routeDecision('WebFetch', escaped)).toBeNull();
    expect(routeDecision('WebSearch', escaped)).toBeNull();
  });

  it('backward compat: boolean arg still works', () => {
    expect(routeDecision('WebFetch', false)?.decision).toBe('deny');
    expect(routeDecision('WebFetch', true)).toBeNull();
  });

  it('never touches other tools', () => {
    expect(routeDecision('Read', withBackend)).toBeNull();
    expect(routeDecision('Bash', withBackend)).toBeNull();
    expect(routeDecision(undefined, withBackend)).toBeNull();
  });

  it('reason names the tool and the escape', () => {
    expect(STRICT_REASON).toContain('CONTEXTPILOT_ALLOW_NATIVE');
  });
});
