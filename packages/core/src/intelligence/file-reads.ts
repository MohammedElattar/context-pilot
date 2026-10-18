import type Database from 'better-sqlite3';
import { getDb } from '../db/connection.js';

export interface FileReadInsight {
  file_path: string;
  read_count: number;
  /** Reads of the same fingerprint beyond the first — likely redundant. */
  unchanged_repeats: number;
  /** True when at least one read of this file was a full (non-partial) read. */
  had_full_read: boolean;
  /** True when every recorded read was a partial slice. */
  partial_only: boolean;
  /** Reads that happened at or after the session's last compaction boundary. */
  reads_after_compaction: number;
  last_read_ms: number;
}

export interface FileReadReport {
  session_id: string;
  /** Last PreCompact timestamp for the session, or null if none. */
  last_compaction_ms: number | null;
  files: FileReadInsight[];
  recommendations: Recommendation[];
}

export interface Recommendation {
  kind: 'reuse-unchanged-read';
  file_path: string;
  reason: string;
  /**
   * 0..1. Lower after a compaction boundary: content read before the last
   * compaction may no longer be in the live context, so "already read" is less
   * certain. Never used to block a read — only to advise.
   */
  confidence: number;
}

interface Row {
  file_path: string;
  timestamp_ms: number;
  is_partial: number | null;
  fingerprint: string | null;
}

/**
 * Analyze a session's file reads for redundant unchanged re-reads, partial vs
 * full coverage, and compaction-aware confidence. Read-only; recommendations
 * only — never blocks a read. A read before the last compaction boundary drops
 * confidence, because its content may no longer be in the live context.
 */
export function analyzeFileReads(sessionId: string, db?: Database.Database): FileReadReport {
  const d = db ?? getDb();

  const lastCompaction = (d
    .prepare(`SELECT MAX(timestamp_ms) AS ts FROM events WHERE session_id = ? AND event_type = 'PreCompact'`)
    .get(sessionId) as { ts: number | null } | undefined)?.ts ?? null;

  const rows = d
    .prepare(`
      SELECT file_path, timestamp_ms, is_partial, fingerprint
      FROM file_reads WHERE session_id = ?
      ORDER BY file_path, timestamp_ms
    `)
    .all(sessionId) as Row[];

  const byPath = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byPath.get(r.file_path) ?? [];
    list.push(r);
    byPath.set(r.file_path, list);
  }

  const files: FileReadInsight[] = [];
  const recommendations: Recommendation[] = [];

  for (const [file_path, reads] of byPath) {
    const read_count = reads.length;
    const fingerprints = reads.map(r => r.fingerprint).filter((f): f is string => f != null);
    // Count reads sharing a fingerprint already seen earlier for this file.
    const seen = new Set<string>();
    let unchanged_repeats = 0;
    for (const fp of fingerprints) {
      if (seen.has(fp)) unchanged_repeats++;
      else seen.add(fp);
    }
    const had_full_read = reads.some(r => r.is_partial === 0);
    const partial_only = reads.length > 0 && reads.every(r => r.is_partial === 1);
    const reads_after_compaction =
      lastCompaction == null ? 0 : reads.filter(r => r.timestamp_ms >= lastCompaction).length;
    const last_read_ms = reads[reads.length - 1].timestamp_ms;

    files.push({ file_path, read_count, unchanged_repeats, had_full_read, partial_only, reads_after_compaction, last_read_ms });

    if (unchanged_repeats > 0 && had_full_read) {
      // Confidence: high when the last read is after the last compaction (still
      // likely in context); lower when the repeat spans a compaction boundary.
      const afterCompaction = lastCompaction == null || last_read_ms >= lastCompaction;
      recommendations.push({
        kind: 'reuse-unchanged-read',
        file_path,
        reason: `${file_path} re-read ${unchanged_repeats} time(s) with an unchanged fingerprint. Reuse the earlier read instead of reading again.`,
        confidence: afterCompaction ? 0.9 : 0.5,
      });
    }
  }

  files.sort((a, b) => b.read_count - a.read_count);
  return { session_id: sessionId, last_compaction_ms: lastCompaction, files, recommendations };
}
