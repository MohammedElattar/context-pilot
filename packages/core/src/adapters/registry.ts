import type { OptimizerAdapter, AdapterStatus, HealthResult } from './types.js';
import { readCavemanConfig } from './caveman/config-reader.js';
import { readCavemanIntegration } from './caveman/integration-reader.js';
import { detectProxy } from '../detection/proxies.js';

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

  conflicts = [];

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


const adapters: OptimizerAdapter[] = [
  new CavemanAdapter(),
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
