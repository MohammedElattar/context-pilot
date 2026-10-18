import { describe, it, expect, afterEach } from 'vitest';
import { getDb, closeDb } from '../db/connection.js';
import {
  putCacheEntry, getFreshCacheEntry, getCacheEntry,
  putEvidence, getEvidence, evidenceId, type ResearchCacheRow, type EvidenceRow,
} from './cache.js';

const HASH = 'ct-urlhash-1';
const CHASH = 'ct-contenthash-1';

function row(fetchedAt: number, ttl: number): ResearchCacheRow {
  return {
    url_hash: HASH, normalized_url: 'https://ct.test/x', final_url: 'https://ct.test/x',
    content_hash: CHASH, content_type: 'text/html', status: 200, body: '<p>hi</p>',
    body_bytes: 9, est_tokens: 3, fetched_at_ms: fetchedAt, ttl_ms: ttl, source: 'research_gateway',
  };
}

afterEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM research_cache WHERE url_hash = ?').run(HASH);
  db.prepare('DELETE FROM research_evidence WHERE url_hash = ?').run(HASH);
  closeDb();
});

describe('research cache TTL + dedup', () => {
  it('returns a fresh entry and treats a past-TTL entry as a miss', () => {
    const db = getDb();
    const t0 = 1_000_000;
    putCacheEntry(row(t0, 1000), db);
    expect(getFreshCacheEntry(HASH, t0 + 500, db)).not.toBeNull();     // within TTL
    expect(getFreshCacheEntry(HASH, t0 + 1000, db)).toBeNull();        // exactly at expiry → miss
    expect(getFreshCacheEntry(HASH, t0 + 5000, db)).toBeNull();        // well past → miss
  });

  it('still returns a stale entry via getCacheEntry (expand recovers it)', () => {
    const db = getDb();
    const t0 = 2_000_000;
    putCacheEntry(row(t0, 1), db);
    expect(getFreshCacheEntry(HASH, t0 + 100, db)).toBeNull(); // stale for a fresh read
    expect(getCacheEntry(HASH, db)?.body).toBe('<p>hi</p>');   // but recoverable
  });

  it('deduplicates evidence by stable evidence_id (INSERT OR IGNORE)', () => {
    const db = getDb();
    const id = evidenceId(CHASH, 0);
    const ev: EvidenceRow = { evidence_id: id, url_hash: HASH, content_hash: CHASH, section_index: 0, heading: 'H', text: 'first', est_tokens: 1, rank_score: 1 };
    putEvidence([ev], db);
    putEvidence([{ ...ev, text: 'second-ignored' }], db); // same id → ignored
    expect(getEvidence(id, db)?.text).toBe('first');
    const n = (db.prepare('SELECT COUNT(*) AS n FROM research_evidence WHERE url_hash = ?').get(HASH) as any).n;
    expect(n).toBe(1);
  });
});
