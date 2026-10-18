import type Database from 'better-sqlite3';
import { getDb } from '../db/connection.js';
import { estimateContextWindowUsage, getCacheReadRatio } from '../db/telemetry-query.js';
import { analyzeFileReads } from './file-reads.js';

export type FactorStatus = 'good' | 'warn' | 'critical' | 'unknown';

export interface HealthFactor {
  key: string;
  label: string;
  status: FactorStatus;
  /** Relative weight in the overall score. */
  weight: number;
  /** 0..1 contribution; null when the data for this factor is unavailable. */
  subscore: number | null;
  /** Human-readable explanation, always set. */
  detail: string;
  /** Raw measured value, when one exists. */
  value: number | null;
}

export interface ContextHealth {
  session_id: string;
  /** 0..100, computed only over factors with known data; null if none known. */
  score: number | null;
  /** 0..1 — fraction of total weight backed by real data. */
  confidence: number;
  factors: HealthFactor[];
  /** Keys of factors whose data was unavailable. */
  missing_data: string[];
}

function status(subscore: number | null, warnBelow: number, criticalBelow: number): FactorStatus {
  if (subscore == null) return 'unknown';
  if (subscore < criticalBelow) return 'critical';
  if (subscore < warnBelow) return 'warn';
  return 'good';
}

/**
 * Explainable context-health score for a session. Each factor reports its own
 * subscore, status, and detail; the overall score is the weighted average over
 * only the factors that have data, and `confidence` reports how much of the
 * total weight that covered. Unavailable factors are listed in `missing_data`
 * and never silently treated as zero.
 */
export function computeContextHealth(sessionId: string, db?: Database.Database): ContextHealth {
  const d = db ?? getDb();

  const ev = d
    .prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN tool_name IS NOT NULL THEN 1 ELSE 0 END), 0) AS tool_calls,
        COALESCE(SUM(CASE WHEN event_type = 'PostToolUse' THEN 1 ELSE 0 END), 0) AS ok,
        COALESCE(SUM(CASE WHEN event_type = 'PostToolUseFailure' THEN 1 ELSE 0 END), 0) AS fail,
        COALESCE(SUM(CASE WHEN event_type = 'PreCompact' THEN 1 ELSE 0 END), 0) AS compactions
      FROM events WHERE session_id = ?
    `)
    .get(sessionId) as { total: number; tool_calls: number; ok: number; fail: number; compactions: number };

  const snapshotCount = (d
    .prepare(`SELECT COUNT(*) AS n FROM token_snapshots WHERE session_id = ? AND (usage_kind = 'observed' OR usage_kind IS NULL)`)
    .get(sessionId) as { n: number }).n;

  const pressure = estimateContextWindowUsage(sessionId, d); // 0..100 or null
  const cacheRatio = getCacheReadRatio(sessionId, d);        // 0..1 or null
  const reads = analyzeFileReads(sessionId, d);
  const redundant = reads.files.reduce((s, f) => s + f.unchanged_repeats, 0);
  const hasReads = reads.files.length > 0;

  const factors: HealthFactor[] = [];

  // Context pressure — lower usage is healthier.
  {
    const sub = pressure == null ? null : Math.max(0, Math.min(1, 1 - pressure / 100));
    factors.push({
      key: 'context_pressure', label: 'Context window pressure', weight: 3,
      subscore: sub, value: pressure,
      status: status(sub, 0.4, 0.15),
      detail: pressure == null ? 'No token snapshots to estimate window usage.' : `Window ~${pressure.toFixed(0)}% full.`,
    });
  }

  // Cache efficiency — higher read ratio is healthier.
  {
    const sub = cacheRatio;
    factors.push({
      key: 'cache_efficiency', label: 'Prompt cache efficiency', weight: 2,
      subscore: sub, value: cacheRatio,
      status: status(sub, 0.6, 0.3),
      detail: cacheRatio == null ? 'No token snapshots to measure cache ratio.' : `Cache read ratio ${(cacheRatio * 100).toFixed(0)}%.`,
    });
  }

  // Redundant file reads — fewer unchanged re-reads is healthier.
  {
    const sub = hasReads ? 1 / (1 + redundant) : null;
    factors.push({
      key: 'redundant_reads', label: 'Redundant file reads', weight: 2,
      subscore: sub, value: hasReads ? redundant : null,
      status: status(sub, 0.9, 0.5),
      detail: !hasReads ? 'No file reads recorded.' : `${redundant} unchanged re-read(s).`,
    });
  }

  // Tool-call volume — fewer calls carry less accumulated context.
  {
    const calls = ev.tool_calls;
    const sub = ev.total > 0 ? Math.max(0, Math.min(1, 1 - Math.max(0, calls - 20) / 80)) : null;
    factors.push({
      key: 'tool_volume', label: 'Tool-call volume', weight: 1,
      subscore: sub, value: ev.total > 0 ? calls : null,
      status: status(sub, 0.75, 0.3),
      detail: ev.total === 0 ? 'No events recorded.' : `${calls} tool call(s).`,
    });
  }

  // Compaction frequency — fewer compactions is healthier.
  {
    const sub = ev.total > 0 ? 1 / (1 + ev.compactions) : null;
    factors.push({
      key: 'compaction_frequency', label: 'Compaction frequency', weight: 1,
      subscore: sub, value: ev.total > 0 ? ev.compactions : null,
      status: status(sub, 0.9, 0.4),
      detail: ev.total === 0 ? 'No events recorded.' : `${ev.compactions} compaction(s).`,
    });
  }

  // Retry rate — fewer tool failures is healthier.
  {
    const attempts = ev.ok + ev.fail;
    const rate = attempts > 0 ? ev.fail / attempts : null;
    const sub = rate == null ? null : 1 - rate;
    factors.push({
      key: 'retry_rate', label: 'Tool failure rate', weight: 2,
      subscore: sub, value: rate,
      status: status(sub, 0.95, 0.8),
      detail: rate == null ? 'No tool outcomes recorded.' : `${(rate * 100).toFixed(0)}% of tool calls failed.`,
    });
  }

  // Telemetry completeness — how many signal sources we actually have.
  {
    const present = [ev.total > 0, snapshotCount > 0, hasReads].filter(Boolean).length;
    // With zero sources the session is unmeasurable, not "0% healthy" — leave
    // the subscore unknown so the overall score stays null rather than 0.
    const sub = present === 0 ? null : present / 3;
    factors.push({
      key: 'telemetry_completeness', label: 'Telemetry completeness', weight: 1,
      subscore: sub, value: present,
      status: status(sub, 0.99, 0.34),
      detail: `${present}/3 signal sources present (events, token snapshots, file reads).`,
    });
  }

  const known = factors.filter(f => f.subscore != null);
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const knownWeight = known.reduce((s, f) => s + f.weight, 0);
  const score = knownWeight > 0
    ? Math.round((known.reduce((s, f) => s + f.weight * (f.subscore as number), 0) / knownWeight) * 100)
    : null;

  return {
    session_id: sessionId,
    score,
    confidence: totalWeight > 0 ? knownWeight / totalWeight : 0,
    factors,
    missing_data: factors.filter(f => f.subscore == null).map(f => f.key),
  };
}
