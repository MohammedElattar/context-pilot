import { describe, it, expect, afterEach } from 'vitest';
import { getDb, closeDb } from '../db/connection.js';
import { normalizeUrl } from './normalize.js';
import { runResearchBenchmark, type ResearchBenchTask } from './benchmark.js';
import type { FetchResult } from './fetch.js';

const ERR = 'ReferenceError: foo is not defined';
const URLS = ['https://bench-a.test/doc', 'https://bench-b.test/doc'];

function bigPage(answer: string): string {
  return `<html><body><article><h2>Intro</h2><p>${'noise '.repeat(400)}</p><h2>Fix</h2><pre>${answer}</pre></article></body></html>`;
}

const fixtures: Record<string, string> = {
  'https://bench-a.test/doc': bigPage(ERR),
  'https://bench-b.test/doc': bigPage('unrelated detail'),
};
const fetchImpl = async (u: string): Promise<FetchResult> => ({ finalUrl: u, status: 200, contentType: 'text/html', body: fixtures[u] ?? '<p>empty</p>', bytes: (fixtures[u] ?? '').length, truncated: false });

afterEach(() => {
  const db = getDb();
  for (const u of URLS) { try { const { urlHash } = normalizeUrl(u); db.prepare('DELETE FROM research_evidence WHERE url_hash = ?').run(urlHash); db.prepare('DELETE FROM research_cache WHERE url_hash = ?').run(urlHash); db.prepare('DELETE FROM research_ledger WHERE url_hash = ?').run(urlHash); } catch {} }
  closeDb();
});

describe('research benchmark harness', () => {
  it('reports a large token reduction while preserving the answer', async () => {
    const tasks: ResearchBenchTask[] = [
      { id: 't1', query: ERR, urls: URLS, expectAnswerIncludes: ERR },
    ];
    const report = await runResearchBenchmark(tasks, { budget_tokens: 400, fetchImpl });
    expect(report.task_count).toBe(1);
    const r = report.results[0];
    expect(r.native.est_model_tokens).toBeGreaterThan(r.gateway.est_model_tokens);
    expect(r.token_reduction_percent).toBeGreaterThan(50);
    expect(r.native.resolved).toBe(true);   // raw dump contains the error
    expect(r.gateway.resolved).toBe(true);   // gateway kept the exact error (protected)
    expect(r.resolution_preserved).toBe(true);
    expect(report.summary.avg_token_reduction_percent).toBeGreaterThan(50);
    expect(report.summary.gateway_resolution_rate).toBe(1);
  });
});
