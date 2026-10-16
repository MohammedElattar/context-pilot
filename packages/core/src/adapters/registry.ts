import type { OptimizerAdapter, AdapterStatus, HealthResult } from './types.js';
import { readCavemanConfig } from './caveman/config-reader.js';
import { readCavemanIntegration } from './caveman/integration-reader.js';
import { detectProxy } from '../detection/proxies.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const execFileAsync = promisify(execFile);

class CavemanAdapter implements OptimizerAdapter {
  id = 'caveman';
  name = 'Caveman Engine/Proxy';
  version: string | null = null;

  capabilities = [
    'compression' as const,
    'recovery' as const,
    'proxy' as const,
    'hook-modifier' as const,
    'mcp-tools' as const,
    'analytics' as const,
  ];

  conflicts = [
    {
      withTool: 'rtk',
      layer: 'PreToolUse hooks',
      severity: 'high' as const,
      reason: 'Both modify Bash tool calls via PreToolUse hooks running in parallel.',
    },
    {
      withTool: 'context-mode',
      layer: 'PostToolUse hooks + compression',
      severity: 'high' as const,
      reason: 'Both compress tool output. Overlapping hooks on 6+ events.',
    },
  ];

  async detect(): Promise<AdapterStatus> {
    const config = await readCavemanConfig();
    if (!config.installed) return 'not-found';

    const integration = await readCavemanIntegration();
    this.version = integration.packVersion;

    return 'installed';
  }

  async healthCheck(): Promise<HealthResult> {
    const proxy = await detectProxy();
    if (!proxy.detected) return { healthy: false, message: 'Proxy not configured' };
    if (!proxy.running) return { healthy: false, message: 'Proxy not running' };
    return { healthy: true, message: `Proxy running on port ${proxy.port}` };
  }
}

class RtkAdapter implements OptimizerAdapter {
  id = 'rtk';
  name = 'RTK (Rust Token Killer)';
  version: string | null = null;

  capabilities = ['compression' as const, 'hook-modifier' as const];

  conflicts = [
    {
      withTool: 'caveman',
      layer: 'PreToolUse hooks',
      severity: 'high' as const,
      reason: 'Both modify Bash tool calls via PreToolUse hooks running in parallel.',
    },
  ];

  async detect(): Promise<AdapterStatus> {
    try {
      const { stdout } = await execFileAsync('rtk', ['--version'], { timeout: 3000 });
      this.version = stdout.trim().match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
      return 'installed';
    } catch {
      try {
        await access(join(homedir(), '.local', 'share', 'rtk'));
        return 'detected';
      } catch {
        return 'not-found';
      }
    }
  }

  async healthCheck(): Promise<HealthResult> {
    const status = await this.detect();
    return status === 'installed'
      ? { healthy: true, message: `RTK v${this.version}` }
      : { healthy: false, message: 'RTK not installed' };
  }
}

class CcusageAdapter implements OptimizerAdapter {
  id = 'ccusage';
  name = 'ccusage';
  version: string | null = null;

  capabilities = ['analytics' as const];
  conflicts = [];

  async detect(): Promise<AdapterStatus> {
    try {
      const { stdout } = await execFileAsync('ccusage', ['--version'], { timeout: 3000 });
      this.version = stdout.trim().match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
      return 'installed';
    } catch {
      return 'not-found';
    }
  }

  async healthCheck(): Promise<HealthResult> {
    const status = await this.detect();
    return status === 'installed'
      ? { healthy: true, message: `ccusage v${this.version}` }
      : { healthy: false, message: 'ccusage not installed' };
  }
}

const adapters: OptimizerAdapter[] = [
  new CavemanAdapter(),
  new RtkAdapter(),
  new CcusageAdapter(),
];

export interface DetectedTool {
  id: string;
  name: string;
  version: string | null;
  status: AdapterStatus;
  healthy: boolean;
  healthMessage: string;
  capabilities: string[];
  conflicts: Array<{ withTool: string; severity: string; reason: string }>;
}

export async function detectAllTools(): Promise<DetectedTool[]> {
  const results: DetectedTool[] = [];

  for (const adapter of adapters) {
    const status = await adapter.detect();
    let health: HealthResult = { healthy: false, message: 'skipped' };

    if (status === 'installed' || status === 'detected') {
      health = await adapter.healthCheck();
    }

    results.push({
      id: adapter.id,
      name: adapter.name,
      version: adapter.version,
      status,
      healthy: health.healthy,
      healthMessage: health.message,
      capabilities: adapter.capabilities,
      conflicts: adapter.conflicts,
    });
  }

  return results;
}
