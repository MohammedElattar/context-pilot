import { readFile } from 'node:fs/promises';
import { paths } from '../config/paths.js';
import { ClaudeJsonSchema, type ClaudeSettings } from '../schema/config.js';
import { loadClaudeSettings } from './environment.js';

export interface PluginInfo {
  id: string;
  enabled: boolean;
}

export interface McpServerInfo {
  name: string;
  type: string;
  command: string;
  args?: string[];
}

export interface PluginsReport {
  plugins: PluginInfo[];
  mcpServers: McpServerInfo[];
}

export async function detectPlugins(): Promise<PluginsReport> {
  const settings = await loadClaudeSettings();
  const plugins = parsePlugins(settings);
  const mcpServers = await parseMcpServers();

  return { plugins, mcpServers };
}

function parsePlugins(settings: ClaudeSettings | null): PluginInfo[] {
  if (!settings?.enabledPlugins) return [];
  return Object.entries(settings.enabledPlugins).map(([id, enabled]) => ({
    id,
    enabled,
  }));
}

async function parseMcpServers(): Promise<McpServerInfo[]> {
  try {
    const raw = await readFile(paths.claude.json, 'utf-8');
    const parsed = ClaudeJsonSchema.parse(JSON.parse(raw));
    if (!parsed.mcpServers) return [];

    return Object.entries(parsed.mcpServers).map(([name, server]) => ({
      name,
      type: server.type,
      command: server.command,
      args: server.args,
    }));
  } catch {
    return [];
  }
}
