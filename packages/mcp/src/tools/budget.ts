import { existsSync } from 'node:fs';
import {
  openReadOnly,
  paths,
  buildPolicyContext,
  getTriggeredPolicies,
  detectProxy,
  readCavemanConfig,
  loadConfig,
  getSessionFileReads,
  getRepeatedFileReadCount,
} from '@contextpilot/core';
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

export async function handleBudget(args: { session_id?: string }) {
  const sessionId = args.session_id ?? queryDb(db => {
    const row = db.prepare('SELECT id FROM sessions ORDER BY started_at DESC LIMIT 1').get() as any;
    return row?.id ?? null;
  }, null);

  if (!sessionId) {
    return { error: 'No sessions found in telemetry DB.' };
  }

  const stats = queryDb(db => {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
    const eventCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM events WHERE session_id = ?'
    ).get(sessionId) as any)?.cnt ?? 0;
    const toolCallCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM events WHERE session_id = ? AND tool_name IS NOT NULL'
    ).get(sessionId) as any)?.cnt ?? 0;
    const payloadBytes = (db.prepare(
      'SELECT COALESCE(SUM(payload_bytes), 0) as total FROM events WHERE session_id = ?'
    ).get(sessionId) as any)?.total ?? 0;
    const fileReads = getSessionFileReads(sessionId, db);
    const repeatedReads = getRepeatedFileReadCount(sessionId, 1, db);
    const topTools = db.prepare(
      'SELECT tool_name, COUNT(*) as cnt FROM events WHERE session_id = ? AND tool_name IS NOT NULL GROUP BY tool_name ORDER BY cnt DESC LIMIT 5'
    ).all(sessionId) as any[];

    return {
      session_id: sessionId,
      started_at: session?.started_at,
      ended_at: session?.ended_at,
      model: session?.model,
      event_count: eventCount,
      tool_call_count: toolCallCount,
      total_payload_bytes: payloadBytes,
      files_read: fileReads.length,
      files_read_multiple_times: repeatedReads,
      top_tools: topTools,
      top_reread_files: fileReads.filter(f => f.read_count > 1).slice(0, 5),
    };
  }, null);

  if (!stats) return { error: 'Could not read session data.' };

  const [proxy, cavemanConfig, config] = await Promise.all([
    detectProxy(),
    readCavemanConfig(),
    Promise.resolve(loadConfig()),
  ]);

  const ctx = buildPolicyContext({
    toolCallCount: stats.tool_call_count,
    repeatedFileReads: stats.files_read_multiple_times,
    cavemanEnabled: proxy.detected,
    cavemanCompressingOutput: cavemanConfig !== null &&
      typeof (cavemanConfig as any).modules === 'object' &&
      (cavemanConfig as any).modules?.output === true,
    currentMode: config.mode,
  });

  const triggered = getTriggeredPolicies(ctx);

  return {
    ...stats,
    duration_minutes: stats.started_at
      ? Math.round(((stats.ended_at ?? Date.now()) - stats.started_at) / 60000)
      : null,
    triggered_policies: triggered.map(p => ({
      name: p.name,
      severity: p.severity,
      reason: p.reason,
      action: p.action,
    })),
    recommendations: triggered.map(p => p.action),
  };
}
