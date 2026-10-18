import { describe, it, expect } from 'vitest';
import { detectAgents, AGENT_ADAPTERS, ClaudeCodeAgentAdapter } from './agent.js';

describe('agent adapters', () => {
  it('registers exactly the validated adapters (Claude Code only)', () => {
    expect(AGENT_ADAPTERS.map(a => a.id)).toEqual(['claude-code']);
  });

  it('detectAgents returns a discovery record per adapter without throwing', async () => {
    const agents = await detectAgents();
    expect(agents).toHaveLength(1);
    const cc = agents[0];
    expect(cc.id).toBe('claude-code');
    expect(['installed', 'detected', 'not-found', 'error']).toContain(cc.status);
    expect(Array.isArray(cc.capabilities)).toBe(true);
    expect(typeof cc.health.healthy).toBe('boolean');
    expect(typeof cc.health.message).toBe('string');
  });

  it('capabilities are a deduplicated subset of the known set', async () => {
    const caps = await ClaudeCodeAgentAdapter.discoverCapabilities();
    const known = new Set(['hook-telemetry', 'token-usage', 'session-tracking', 'file-read-tracking', 'mcp-tools']);
    expect(new Set(caps).size).toBe(caps.length); // no duplicates
    for (const c of caps) expect(known.has(c)).toBe(true);
  });
});
