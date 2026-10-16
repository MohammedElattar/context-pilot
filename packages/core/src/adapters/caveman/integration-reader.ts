import { readFile } from 'node:fs/promises';
import { paths } from '../../config/paths.js';
import { CavemanIntegrationSchema, type CavemanIntegration } from '../../schema/caveman.js';

export interface CavemanIntegrationInfo {
  loaded: boolean;
  agent: string | null;
  packVersion: string | null;
  detectedAgentVersion: string | null;
  ownedRoute: string | null;
  mcpInstalled: boolean;
  operationCount: number;
}

export async function readCavemanIntegration(): Promise<CavemanIntegrationInfo> {
  try {
    const raw = await readFile(paths.caveman.claudeIntegration, 'utf-8');
    const data = CavemanIntegrationSchema.parse(JSON.parse(raw));

    let ownedRoute: string | null = null;
    let mcpInstalled = false;

    for (const op of data.operations) {
      if (op.kind === 'claude-settings' && op.owned) {
        ownedRoute = (op.owned as Record<string, unknown>).route as string ?? null;
      }
      if (op.kind === 'claude-mcp' && op.owned) {
        mcpInstalled = true;
      }
    }

    return {
      loaded: true,
      agent: data.agent,
      packVersion: data.pack_version ?? null,
      detectedAgentVersion: data.detected_agent_version ?? null,
      ownedRoute,
      mcpInstalled,
      operationCount: data.operations.length,
    };
  } catch {
    return {
      loaded: false,
      agent: null,
      packVersion: null,
      detectedAgentVersion: null,
      ownedRoute: null,
      mcpInstalled: false,
      operationCount: 0,
    };
  }
}
