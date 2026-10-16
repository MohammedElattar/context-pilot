import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { paths } from './paths.js';

export type OperatingMode = 'observe' | 'canary' | 'auto';

const ConfigSchema = z.object({
  mode: z.enum(['observe', 'canary', 'auto']).default('observe'),
  updatedAt: z.string().optional(),
}).passthrough();

export interface ContextPilotConfig {
  mode: OperatingMode;
  updatedAt?: string;
}

export function loadConfig(): ContextPilotConfig {
  try {
    const raw = readFileSync(paths.contextPilot.config, 'utf-8');
    return ConfigSchema.parse(JSON.parse(raw));
  } catch {
    return { mode: 'observe' };
  }
}

export function saveConfig(config: ContextPilotConfig): void {
  mkdirSync(dirname(paths.contextPilot.config), { recursive: true });
  const data = { ...config, updatedAt: new Date().toISOString() };
  writeFileSync(paths.contextPilot.config, JSON.stringify(data, null, 2) + '\n');
}

export function setMode(mode: OperatingMode): ContextPilotConfig {
  const config = loadConfig();
  config.mode = mode;
  saveConfig(config);
  return config;
}
