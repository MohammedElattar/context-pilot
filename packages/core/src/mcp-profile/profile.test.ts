import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../db/connection.js';
import { insertEvent, upsertSession } from '../db/telemetry-store.js';
import { profileMcpTools, profileMcpServers, findUnusedMcpTools, parseMcpToolName } from './profile.js';

describe('MCP profiler', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM events WHERE session_id LIKE ?").run('mp-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('mp-%');
    upsertSession({ id: 'mp-1', started_at: Date.now() });
  });

  afterEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM events WHERE session_id LIKE ?").run('mp-%');
    db.prepare("DELETE FROM sessions WHERE id LIKE ?").run('mp-%');
    closeDb();
  });

  it('parses mcp__server__tool names', () => {
    expect(parseMcpToolName('mcp__caveman__caveman_compress')).toEqual({ server: 'caveman', tool: 'caveman_compress' });
    expect(parseMcpToolName('Read')).toBeNull();
  });

  it('profiles only MCP tool events', () => {
    insertEvent({ session_id: 'mp-1', event_type: 'PostToolUse', timestamp_ms: 1, tool_name: 'Read', payload_bytes: 100, event_id: 'r1' });
    insertEvent({ session_id: 'mp-1', event_type: 'PostToolUse', timestamp_ms: 2, tool_name: 'mcp__caveman__caveman_compress', payload_bytes: 200, duration_ms: 50, event_id: 'm1' });
    insertEvent({ session_id: 'mp-1', event_type: 'PostToolUse', timestamp_ms: 3, tool_name: 'mcp__caveman__caveman_compress', payload_bytes: 400, duration_ms: 150, event_id: 'm2' });

    const tools = profileMcpTools({ sessionId: 'mp-1' });
    expect(tools).toHaveLength(1);
    const t = tools[0];
    expect(t.server).toBe('caveman');
    expect(t.tool).toBe('caveman_compress');
    expect(t.calls).toBe(2);
    expect(t.total_bytes).toBe(600);
    expect(t.avg_bytes).toBe(300);
    expect(t.avg_duration_ms).toBeCloseTo(100, 5);
  });

  it('computes error_rate from PostToolUseFailure', () => {
    insertEvent({ session_id: 'mp-1', event_type: 'PostToolUse', timestamp_ms: 1, tool_name: 'mcp__srv__a', event_id: 'a1' });
    insertEvent({ session_id: 'mp-1', event_type: 'PostToolUseFailure', timestamp_ms: 2, tool_name: 'mcp__srv__a', event_id: 'a2' });
    const tools = profileMcpTools({ sessionId: 'mp-1' });
    expect(tools[0].error_rate).toBeCloseTo(0.5, 5);
  });

  it('aggregates per server', () => {
    insertEvent({ session_id: 'mp-1', event_type: 'PostToolUse', timestamp_ms: 1, tool_name: 'mcp__srv__a', duration_ms: 100, payload_bytes: 10, event_id: 'a1' });
    insertEvent({ session_id: 'mp-1', event_type: 'PostToolUse', timestamp_ms: 2, tool_name: 'mcp__srv__b', duration_ms: 300, payload_bytes: 20, event_id: 'b1' });
    const servers = profileMcpServers({ sessionId: 'mp-1' });
    expect(servers).toHaveLength(1);
    expect(servers[0].server).toBe('srv');
    expect(servers[0].tools).toBe(2);
    expect(servers[0].calls).toBe(2);
    expect(servers[0].avg_duration_ms).toBeCloseTo(200, 5);
  });

  it('finds unused configured tools', () => {
    insertEvent({ session_id: 'mp-1', event_type: 'PostToolUse', timestamp_ms: 1, tool_name: 'mcp__srv__used', event_id: 'u1' });
    const unused = findUnusedMcpTools(['mcp__srv__used', 'mcp__srv__never'], { sessionId: 'mp-1' });
    expect(unused).toEqual(['mcp__srv__never']);
  });
});
