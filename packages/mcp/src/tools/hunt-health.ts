import { existsSync } from 'node:fs';
import { openReadOnly, paths } from '@contextpilot/core';
import type Database from 'better-sqlite3';

function queryDb<T>(fn: (db: Database.Database) => T, fallback: T): T {
  if (!existsSync(paths.contextPilot.db)) return fallback;
  try {
    const db = openReadOnly(paths.contextPilot.db);
    const result = fn(db);
    db.close();
    return result;
  } catch {
    return fallback;
  }
}

export async function handleHuntHealth(args: { session_id?: string }) {
  const sessionId = args.session_id ?? queryDb(db => {
    const row = db.prepare('SELECT id FROM sessions ORDER BY started_at DESC LIMIT 1').get() as any;
    return row?.id ?? null;
  }, null);

  if (!sessionId) {
    return { error: 'No sessions found in telemetry DB.' };
  }

  const repeatedSkillReads = queryDb(db => {
    return db.prepare(
      `SELECT file_path, read_count FROM file_reads
       WHERE session_id = ? AND file_path LIKE '%/skills/hunt-%' AND read_count > 1
       ORDER BY read_count DESC`
    ).all(sessionId) as { file_path: string; read_count: number }[];
  }, [] as { file_path: string; read_count: number }[]);

  const reconBytes = queryDb(db => {
    const row = db.prepare(
      `SELECT COALESCE(SUM(payload_bytes), 0) as total FROM events
       WHERE session_id = ? AND tool_name = 'Bash'
       AND (payload_bytes > 5000)`
    ).get(sessionId) as any;
    return row?.total ?? 0;
  }, 0);

  const routingAdoption = queryDb(db => {
    const gateway = (db.prepare(
      `SELECT COUNT(*) as cnt FROM events
       WHERE session_id = ? AND tool_name IN ('contextpilot_fetch', 'contextpilot_research', 'contextpilot_search')`
    ).get(sessionId) as any)?.cnt ?? 0;
    const native = (db.prepare(
      `SELECT COUNT(*) as cnt FROM events
       WHERE session_id = ? AND tool_name IN ('WebFetch', 'WebSearch')`
    ).get(sessionId) as any)?.cnt ?? 0;
    const total = gateway + native;
    return {
      gateway_calls: gateway,
      native_calls: native,
      adoption_pct: total > 0 ? Math.round(gateway / total * 100) : null,
    };
  }, { gateway_calls: 0, native_calls: 0, adoption_pct: null as number | null });

  const longStalls = queryDb(db => {
    return db.prepare(
      `SELECT tool_name, duration_ms FROM events
       WHERE session_id = ? AND duration_ms > 30000
       ORDER BY duration_ms DESC LIMIT 10`
    ).all(sessionId) as { tool_name: string; duration_ms: number }[];
  }, [] as { tool_name: string; duration_ms: number }[]);

  const dedupDiscipline = queryDb(db => {
    const dedupCheck = (db.prepare(
      `SELECT COUNT(*) as cnt FROM events
       WHERE session_id = ? AND tool_name = 'Bash'
       AND payload_bytes > 0`
    ).get(sessionId) as any)?.cnt ?? 0;
    const reportSkillRead = (db.prepare(
      `SELECT COUNT(*) as cnt FROM file_reads
       WHERE session_id = ? AND (file_path LIKE '%/report-writing/%' OR file_path LIKE '%/skills/report/%')`
    ).get(sessionId) as any)?.cnt ?? 0;
    return {
      dedup_bash_calls: dedupCheck,
      report_skill_reads: reportSkillRead,
      warning: reportSkillRead > 0 && dedupCheck === 0 ? 'Report drafting detected without dedup check.' : null,
    };
  }, { dedup_bash_calls: 0, report_skill_reads: 0, warning: null as string | null });

  const toolCallCount = queryDb(db => {
    return (db.prepare(
      'SELECT COUNT(*) as cnt FROM events WHERE session_id = ? AND tool_name IS NOT NULL'
    ).get(sessionId) as any)?.cnt ?? 0;
  }, 0);

  return {
    session_id: sessionId,
    tool_call_count: toolCallCount,
    hunt_waste_signals: {
      repeated_skill_reads: repeatedSkillReads,
      recon_output_bytes: reconBytes,
      research_routing: routingAdoption,
      long_stalls: longStalls,
      dedup_discipline: dedupDiscipline,
    },
    recommendations: [
      ...(repeatedSkillReads.length > 0 ? ['Avoid re-reading hunt skills — load once per agent.'] : []),
      ...(reconBytes > 50000 ? ['Recon output is very large — use recon_summary() to compress.'] : []),
      ...(routingAdoption.adoption_pct !== null && routingAdoption.adoption_pct < 80
        ? ['Low research gateway adoption — prefer contextpilot_fetch/research over WebFetch.'] : []),
      ...(longStalls.length > 3 ? [`${longStalls.length} tool calls stalled >30s — check for timeouts.`] : []),
      ...(dedupDiscipline.warning ? [dedupDiscipline.warning] : []),
    ],
  };
}
