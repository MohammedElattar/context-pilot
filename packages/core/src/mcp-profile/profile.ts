import type Database from 'better-sqlite3';
import { getDb } from '../db/connection.js';

export interface McpToolProfile {
  server: string;
  tool: string;
  tool_name: string;
  calls: number;
  failures: number;
  error_rate: number;
  avg_duration_ms: number | null;
  total_bytes: number;
  avg_bytes: number;
}

export interface McpServerProfile {
  server: string;
  tools: number;
  calls: number;
  failures: number;
  error_rate: number;
  avg_duration_ms: number | null;
  total_bytes: number;
}

/** Split a Claude Code MCP tool name `mcp__<server>__<tool>` into parts. */
export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith('mcp__')) return null;
  const rest = toolName.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  if (sep === -1) return { server: rest, tool: '' };
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

export interface ProfileOptions {
  sinceMs?: number;
  /** Scope to one session; omit to profile across all sessions. */
  sessionId?: string;
  db?: Database.Database;
}

interface Row {
  tool_name: string;
  calls: number;
  failures: number;
  avg_duration_ms: number | null;
  total_bytes: number;
}

function rows(opts: ProfileOptions, db: Database.Database): Row[] {
  const clauses = [`tool_name LIKE 'mcp\\_\\_%' ESCAPE '\\'`];
  const params: (number | string)[] = [];
  if (opts.sinceMs) { clauses.push('timestamp_ms >= ?'); params.push(opts.sinceMs); }
  if (opts.sessionId) { clauses.push('session_id = ?'); params.push(opts.sessionId); }
  return db
    .prepare(`
      SELECT
        tool_name,
        COUNT(*) AS calls,
        COALESCE(SUM(CASE WHEN event_type = 'PostToolUseFailure' THEN 1 ELSE 0 END), 0) AS failures,
        AVG(duration_ms) AS avg_duration_ms,
        COALESCE(SUM(COALESCE(payload_bytes, 0)), 0) AS total_bytes
      FROM events
      WHERE ${clauses.join(' AND ')}
      GROUP BY tool_name
      ORDER BY calls DESC
    `)
    .all(...params) as Row[];
}

/** Per-tool MCP usage profile from recorded events. Read-only. */
export function profileMcpTools(opts: ProfileOptions = {}): McpToolProfile[] {
  const d = opts.db ?? getDb();
  return rows(opts, d).map(r => {
    const parsed = parseMcpToolName(r.tool_name);
    return {
      server: parsed?.server ?? 'unknown',
      tool: parsed?.tool ?? r.tool_name,
      tool_name: r.tool_name,
      calls: r.calls,
      failures: r.failures,
      error_rate: r.calls > 0 ? r.failures / r.calls : 0,
      avg_duration_ms: r.avg_duration_ms,
      total_bytes: r.total_bytes,
      avg_bytes: r.calls > 0 ? Math.round(r.total_bytes / r.calls) : 0,
    };
  });
}

/** Per-server MCP usage profile, aggregated from the per-tool profile. */
export function profileMcpServers(opts: ProfileOptions = {}): McpServerProfile[] {
  const tools = profileMcpTools(opts);
  const byServer = new Map<string, McpToolProfile[]>();
  for (const t of tools) {
    const list = byServer.get(t.server) ?? [];
    list.push(t);
    byServer.set(t.server, list);
  }
  const out: McpServerProfile[] = [];
  for (const [server, ts] of byServer) {
    const calls = ts.reduce((s, t) => s + t.calls, 0);
    const failures = ts.reduce((s, t) => s + t.failures, 0);
    const totalBytes = ts.reduce((s, t) => s + t.total_bytes, 0);
    // Duration-weighted average over tools that recorded a duration.
    const durTools = ts.filter(t => t.avg_duration_ms != null);
    const weighted = durTools.reduce((s, t) => s + (t.avg_duration_ms as number) * t.calls, 0);
    const durCalls = durTools.reduce((s, t) => s + t.calls, 0);
    out.push({
      server,
      tools: ts.length,
      calls,
      failures,
      error_rate: calls > 0 ? failures / calls : 0,
      avg_duration_ms: durCalls > 0 ? weighted / durCalls : null,
      total_bytes: totalBytes,
    });
  }
  return out.sort((a, b) => b.calls - a.calls);
}

/**
 * MCP tools that are configured/available but never invoked in the window.
 * `availableToolNames` are full `mcp__server__tool` names from discovery.
 */
export function findUnusedMcpTools(availableToolNames: string[], opts: ProfileOptions = {}): string[] {
  const used = new Set(profileMcpTools(opts).map(t => t.tool_name));
  return availableToolNames.filter(name => !used.has(name));
}
