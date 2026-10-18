import { existsSync } from 'node:fs';
import { detectEnvironment } from '../detection/environment.js';
import { detectHooks } from '../detection/hooks.js';
import { paths } from '../config/paths.js';
import type { AdapterStatus } from './types.js';

/**
 * Capabilities a coding-agent integration can expose. Discovery-based: an
 * adapter reports only what it can actually observe for that agent, so callers
 * never assume a capability another agent lacks.
 */
export type AgentCapability =
  | 'hook-telemetry'
  | 'token-usage'
  | 'session-tracking'
  | 'file-read-tracking'
  | 'mcp-tools';

export interface AgentHealth {
  healthy: boolean;
  message: string;
}

export interface AgentAdapter {
  id: string;
  name: string;
  detect(): Promise<AdapterStatus>;
  /** What ContextPilot can observe for this agent, discovered at runtime. */
  discoverCapabilities(): Promise<AgentCapability[]>;
  health(): Promise<AgentHealth>;
}

/**
 * Claude Code adapter — the one validated integration. Capabilities are
 * discovered from what is actually wired (observer hooks, telemetry DB), not
 * assumed. Other agents (Codex, Gemini, OpenCode) are intentionally absent
 * until their real hook/telemetry APIs are validated — no fabricated support.
 */
export const ClaudeCodeAgentAdapter: AgentAdapter = {
  id: 'claude-code',
  name: 'Claude Code',

  async detect(): Promise<AdapterStatus> {
    try {
      const env = await detectEnvironment();
      return env.claudeCode.installed ? 'installed' : 'not-found';
    } catch {
      return 'error';
    }
  },

  async discoverCapabilities(): Promise<AgentCapability[]> {
    const caps: AgentCapability[] = [];
    try {
      const hooks = await detectHooks();
      const ourHooks = hooks.hooks.filter(h => h.owner === 'contextpilot');
      if (ourHooks.length > 0) {
        caps.push('hook-telemetry', 'session-tracking', 'file-read-tracking');
      }
      // Token usage is available only once snapshots exist; MCP is always
      // offered by Claude Code.
      caps.push('mcp-tools');
      if (existsSync(paths.contextPilot.db)) caps.push('token-usage');
    } catch {
      // discovery is best-effort; return whatever we gathered
    }
    return [...new Set(caps)];
  },

  async health(): Promise<AgentHealth> {
    try {
      const env = await detectEnvironment();
      if (!env.claudeCode.installed) return { healthy: false, message: 'Claude Code not detected.' };
      const hooks = await detectHooks();
      const ours = hooks.hooks.filter(h => h.owner === 'contextpilot').length;
      if (ours === 0) return { healthy: false, message: 'Claude Code found, but ContextPilot observer hooks are not registered. Run `contextpilot setup`.' };
      return { healthy: true, message: `Claude Code integrated (${ours} ContextPilot hook(s) registered).` };
    } catch (e) {
      return { healthy: false, message: `Health check failed: ${(e as Error).message}` };
    }
  },
};

export const AGENT_ADAPTERS: AgentAdapter[] = [ClaudeCodeAgentAdapter];

export interface DetectedAgent {
  id: string;
  name: string;
  status: AdapterStatus;
  capabilities: AgentCapability[];
  health: AgentHealth;
}

/** Discover all known coding-agent integrations and their live capabilities. */
export async function detectAgents(): Promise<DetectedAgent[]> {
  return Promise.all(
    AGENT_ADAPTERS.map(async a => ({
      id: a.id,
      name: a.name,
      status: await a.detect(),
      capabilities: await a.discoverCapabilities(),
      health: await a.health(),
    })),
  );
}
