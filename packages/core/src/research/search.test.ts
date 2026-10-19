import { describe, it, expect } from 'vitest';
import { searchWeb } from './search.js';
import type { FetchResult } from './fetch.js';

function fakeFetch(body: string, status = 200) {
  return async (_url: string): Promise<FetchResult> => ({
    finalUrl: _url, status, contentType: 'application/json', body, bytes: body.length, truncated: false,
  });
}

describe('searchWeb', () => {
  it('uses SearXNG first when configured, parsing JSON results', async () => {
    const body = JSON.stringify({ results: [
      { title: 'A', url: 'https://a.test', content: 'alpha snippet' },
      { title: 'B', url: 'https://b.test', content: 'beta snippet' },
    ] });
    const r = await searchWeb('crash', { searxngUrl: 'http://127.0.0.1:8080', fetchImpl: fakeFetch(body) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provider).toBe('searxng');
    expect(r.results.map(x => x.url)).toEqual(['https://a.test', 'https://b.test']);
    expect(r.results[0].snippet).toBe('alpha snippet');
  });

  it('falls back to Brave when only a key is set', async () => {
    const body = JSON.stringify({ web: { results: [{ title: 'C', url: 'https://c.test', description: 'gamma' }] } });
    const r = await searchWeb('crash', { braveKey: 'k', fetchImpl: fakeFetch(body) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provider).toBe('brave');
    expect(r.results[0].url).toBe('https://c.test');
  });

  it('returns a native-fallback note when no backend is configured', async () => {
    const r = await searchWeb('crash', { searxngUrl: '', braveKey: '', fetchImpl: fakeFetch('{}') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('no_backend');
    expect(r.fallback).toMatch(/native WebSearch/i);
  });

  it('passes the SearXNG host to the real fetch as an allowed private host (localhost)', async () => {
    // No fetchImpl → real safeFetch. localhost would normally be SSRF-blocked;
    // allowPrivateHost must let it through, so the error is a connection error
    // (nothing listening), NOT ssrf_blocked.
    const r = await searchWeb('x', { searxngUrl: 'http://127.0.0.1:9' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).not.toBe('ssrf_blocked');
  });
});
