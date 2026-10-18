import { describe, it, expect, afterEach } from 'vitest';
import { getDb, closeDb } from '../db/connection.js';
import { normalizeUrl } from './normalize.js';
import { researchQuery } from './research.js';
import type { FetchResult } from './fetch.js';

const URLS = ['https://a.test/doc', 'https://b.test/doc', 'https://github.com/o/r/issues/5'];

function page(title: string, extra: string): string {
  return `<html><body><article><h2>${title}</h2><p>${'lorem ipsum '.repeat(60)}</p><h2>Detail</h2><pre>${extra}</pre></article></body></html>`;
}

afterEach(() => {
  const db = getDb();
  for (const u of [...URLS, 'https://github.com/o/r/issues/5']) {
    try {
      const { urlHash } = normalizeUrl(u);
      db.prepare('DELETE FROM research_evidence WHERE url_hash = ?').run(urlHash);
      db.prepare('DELETE FROM research_cache WHERE url_hash = ?').run(urlHash);
      db.prepare('DELETE FROM research_ledger WHERE url_hash = ?').run(urlHash); // scoped — never touch real rows
    } catch {}
  }
  closeDb();
});

describe('researchQuery (multi-source)', () => {
  it('returns guidance when no URLs are supplied', async () => {
    const r = await researchQuery({ query: 'why crash' });
    expect(r.ok).toBe(true);
    expect(r.sources).toEqual([]);
    expect(r.notes[0]).toMatch(/No URLs supplied/);
  });

  it('merges evidence across web sources under one budget with provenance', async () => {
    const bodies: Record<string, string> = {
      'https://a.test/doc': page('Alpha', 'AAA unique content'),
      'https://b.test/doc': page('Beta', 'BBB unique content'),
    };
    const fetchImpl = async (u: string): Promise<FetchResult> => ({ finalUrl: u, status: 200, contentType: 'text/html', body: bodies[u], bytes: bodies[u].length, truncated: false });
    const r = await researchQuery({ query: 'unique content', urls: ['https://a.test/doc', 'https://b.test/doc'], budget_tokens: 5000, fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.sources.filter(s => s.ok).length).toBe(2);
    const srcs = new Set(r.evidence.map(e => e.source_url));
    expect(srcs.has('https://a.test/doc') && srcs.has('https://b.test/doc')).toBe(true);
    expect(r.budget.est_tokens_out).toBeLessThanOrEqual(5000);
  });

  it('researches a GitHub issue via a stubbed gh runner', async () => {
    const issue = { title: 'Bug', state: 'open', user: { login: 'rep' }, labels: ['bug'], body: 'ENOENT: no such file' };
    const comments = [{ user: { login: 'maint' }, body: 'fixed in v2', author_association: 'OWNER' }];
    const ghExec = async (args: string[]) => (args[1].includes('/comments') ? JSON.stringify(comments) : JSON.stringify(issue));
    const r = await researchQuery({ query: 'ENOENT', urls: ['https://github.com/o/r/issues/5'], budget_tokens: 4000, ghExec });
    expect(r.ok).toBe(true);
    expect(r.sources[0]).toMatchObject({ kind: 'github', ok: true });
    const text = r.evidence.map(e => e.text).join('\n');
    expect(text).toContain('ENOENT: no such file'); // error preserved from the issue body
  });

  it('reports a failed source without throwing', async () => {
    const fetchImpl = async (): Promise<FetchResult> => { throw new Error('down'); };
    const r = await researchQuery({ query: 'x', urls: ['https://a.test/doc'], fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.sources[0].ok).toBe(false);
    expect(r.notes.some(n => /All sources failed/.test(n))).toBe(true);
  });
});
