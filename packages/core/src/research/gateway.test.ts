import { describe, it, expect, afterEach } from 'vitest';
import { getDb, closeDb } from '../db/connection.js';
import { normalizeUrl } from './normalize.js';
import { fetchResearch, expandEvidence } from './gateway.js';
import type { FetchResult } from './fetch.js';
import { FetchError } from './fetch.js';

const ERROR_MSG = "TypeError: Cannot read properties of undefined (reading 'foo')";

function html(sections: number): string {
  const blocks: string[] = ['<html><head><title>Doc</title></head><body><article>'];
  for (let i = 0; i < sections; i++) {
    blocks.push(`<h2>Section ${i}</h2><p>${'filler lorem ipsum dolor '.repeat(40)}</p>`);
  }
  // The essential evidence sits in a LOW-ranked position with no focus terms in
  // its heading — only the verbatim error marks it.
  blocks.push(`<h2>Appendix</h2><pre>Traceback:\n${ERROR_MSG}\n    at app.js:42</pre>`);
  blocks.push('</article></body></html>');
  return blocks.join('');
}

function fakeFetcher(body: string, counter?: { n: number }, contentType = 'text/html; charset=utf-8') {
  return async (url: string): Promise<FetchResult> => {
    if (counter) counter.n++;
    return { finalUrl: url, status: 200, contentType, body, bytes: Buffer.byteLength(body), truncated: false };
  };
}

const USED_URLS = new Set<string>();
function track(url: string): string { USED_URLS.add(url); return url; }

afterEach(() => {
  const db = getDb();
  for (const u of USED_URLS) {
    try {
      const { urlHash } = normalizeUrl(u);
      db.prepare('DELETE FROM research_evidence WHERE url_hash = ?').run(urlHash);
      db.prepare('DELETE FROM research_cache WHERE url_hash = ?').run(urlHash);
      db.prepare('DELETE FROM research_ledger WHERE url_hash = ?').run(urlHash);
    } catch { /* ignore */ }
  }
  USED_URLS.clear();
  closeDb();
});

describe('research gateway (Slice 1)', () => {
  it('trims a large doc to the token budget and omits the rest', async () => {
    const url = track('https://large.test/doc');
    const res = await fetchResearch({ url, focus: 'section', budget_tokens: 150, fetchImpl: fakeFetcher(html(30)) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.omitted.length).toBeGreaterThan(0);
    // Budget respected except for protected overflow.
    expect(res.budget.est_tokens_out <= res.budget.configured_tokens || res.budget.overflow).toBe(true);
    expect(res.budget.est_tokens_in).toBeGreaterThan(res.budget.est_tokens_out);
  });

  it('never drops the exact error message, even when low-ranked and over budget', async () => {
    const url = track('https://err.test/doc');
    const res = await fetchResearch({ url, focus: ERROR_MSG, budget_tokens: 50, fetchImpl: fakeFetcher(html(20)) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const joined = res.evidence.map(e => e.text).join('\n');
    expect(joined).toContain(ERROR_MSG); // verbatim preservation
  });

  it('serves a repeat fetch from cache with no second network call', async () => {
    const url = track('https://cache.test/doc');
    const counter = { n: 0 };
    const impl = fakeFetcher(html(5), counter);
    const first = await fetchResearch({ url, fetchImpl: impl });
    const second = await fetchResearch({ url, fetchImpl: impl });
    expect(first.ok && !first.source.from_cache).toBe(true);
    expect(second.ok && second.source.from_cache).toBe(true);
    expect(counter.n).toBe(1);
  });

  it('deduplicates identical content fetched from different URLs', async () => {
    const a = track('https://dup-a.test/x');
    const b = track('https://dup-b.test/y');
    const body = html(4);
    const r1 = await fetchResearch({ url: a, fetchImpl: fakeFetcher(body) });
    const r2 = await fetchResearch({ url: b, fetchImpl: fakeFetcher(body) });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.source.content_hash).toBe(r2.source.content_hash);
    expect(r2.source.deduplicated).toBe(true);
  });

  it('handles malformed HTML without throwing', async () => {
    const url = track('https://bad.test/x');
    const res = await fetchResearch({ url, fetchImpl: fakeFetcher('<div><p>Broken <b>unclosed <pre>trace\n at x</pre>') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it('fails open on a fetch error, pointing to native tools', async () => {
    const url = track('https://fail.test/x');
    const res = await fetchResearch({ url, fetchImpl: async () => { throw new FetchError('boom', 'network'); } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('network');
    expect(res.fallback).toMatch(/native/i);
  });

  it('blocks a sensitive URL via the real SSRF guard (no fetchImpl)', async () => {
    const res = await fetchResearch({ url: track('http://169.254.169.254/latest/meta-data/') });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('ssrf_blocked');
  });

  it('refetches after the cache entry goes stale (TTL expiry)', async () => {
    const url = track('https://stale.test/doc');
    const counter = { n: 0 };
    const impl = fakeFetcher(html(4), counter);
    const first = await fetchResearch({ url, ttl_ms: 1, fetchImpl: impl });
    await new Promise(r => setTimeout(r, 10)); // let the 1ms TTL lapse
    const second = await fetchResearch({ url, ttl_ms: 1, fetchImpl: impl });
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.source.from_cache).toBe(false); // stale → refetch
    expect(counter.n).toBe(2);
  });

  it('expands evidence from cache even after the entry is stale, no network', async () => {
    const url = track('https://staleexpand.test/doc');
    const res = await fetchResearch({ url, focus: 'section', budget_tokens: 100, ttl_ms: 1, fetchImpl: fakeFetcher(html(10)) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await new Promise(r => setTimeout(r, 10));
    const full = expandEvidence({ evidence_id: res.evidence[0].evidence_id, mode: 'full' });
    expect(full.ok).toBe(true); // recoverable despite TTL expiry
  });

  it('expands an omitted section and the full body by stable id, no network', async () => {
    const url = track('https://expand.test/doc');
    const res = await fetchResearch({ url, focus: 'section', budget_tokens: 120, fetchImpl: fakeFetcher(html(15)) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.omitted.length).toBeGreaterThan(0);

    const section = expandEvidence({ evidence_id: res.omitted[0].evidence_id });
    expect(section.ok).toBe(true);
    if (!section.ok) return;
    expect(section.text.length).toBeGreaterThan(0);

    const full = expandEvidence({ evidence_id: res.omitted[0].evidence_id, mode: 'full' });
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.text).toContain(ERROR_MSG); // full body retains exact evidence
  });
});
