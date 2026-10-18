import { getDb } from '../db/connection.js';
import type Database from 'better-sqlite3';

export interface ResearchCacheRow {
  url_hash: string;
  normalized_url: string;
  final_url: string | null;
  content_hash: string | null;
  content_type: string | null;
  status: number | null;
  body: string | null;
  body_bytes: number | null;
  est_tokens: number | null;
  fetched_at_ms: number;
  ttl_ms: number;
  source: string | null;
}

export interface EvidenceRow {
  evidence_id: string;
  url_hash: string;
  content_hash: string | null;
  section_index: number;
  heading: string | null;
  text: string;
  est_tokens: number | null;
  rank_score: number | null;
}

/** Stable evidence id: identical content + section collapses across URLs. */
export function evidenceId(contentHash: string, sectionIndex: number): string {
  return `${contentHash}:${sectionIndex}`;
}

/** Best-effort cache write (fail-open: a cache error never loses evidence). */
export function putCacheEntry(row: ResearchCacheRow, db: Database.Database = getDb()): void {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO research_cache
        (url_hash, normalized_url, final_url, content_hash, content_type, status,
         body, body_bytes, est_tokens, fetched_at_ms, ttl_ms, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.url_hash, row.normalized_url, row.final_url, row.content_hash,
      row.content_type, row.status, row.body, row.body_bytes, row.est_tokens,
      row.fetched_at_ms, row.ttl_ms, row.source,
    );
  } catch { /* fail open */ }
}

export function putEvidence(rows: EvidenceRow[], db: Database.Database = getDb()): void {
  if (rows.length === 0) return;
  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO research_evidence
        (evidence_id, url_hash, content_hash, section_index, heading, text, est_tokens, rank_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction((items: EvidenceRow[]) => {
      for (const r of items) {
        stmt.run(r.evidence_id, r.url_hash, r.content_hash, r.section_index,
          r.heading, r.text, r.est_tokens, r.rank_score);
      }
    });
    tx(rows);
  } catch { /* fail open */ }
}

/** Fresh cache entry for a url_hash, or null when absent or past its TTL. */
export function getFreshCacheEntry(
  urlHash: string,
  nowMs = Date.now(),
  db: Database.Database = getDb(),
): ResearchCacheRow | null {
  try {
    const row = db.prepare('SELECT * FROM research_cache WHERE url_hash = ?').get(urlHash) as ResearchCacheRow | undefined;
    if (!row) return null;
    if (row.fetched_at_ms + row.ttl_ms <= nowMs) return null; // stale → miss
    return row;
  } catch {
    return null;
  }
}

/** Cache entry regardless of TTL — used by expand to recover full evidence. */
export function getCacheEntry(urlHash: string, db: Database.Database = getDb()): ResearchCacheRow | null {
  try {
    return (db.prepare('SELECT * FROM research_cache WHERE url_hash = ?').get(urlHash) as ResearchCacheRow | undefined) ?? null;
  } catch {
    return null;
  }
}

export function getEvidence(id: string, db: Database.Database = getDb()): EvidenceRow | null {
  try {
    return (db.prepare('SELECT * FROM research_evidence WHERE evidence_id = ?').get(id) as EvidenceRow | undefined) ?? null;
  } catch {
    return null;
  }
}

export function getEvidenceForUrl(urlHash: string, db: Database.Database = getDb()): EvidenceRow[] {
  try {
    return db.prepare('SELECT * FROM research_evidence WHERE url_hash = ? ORDER BY section_index').all(urlHash) as EvidenceRow[];
  } catch {
    return [];
  }
}
