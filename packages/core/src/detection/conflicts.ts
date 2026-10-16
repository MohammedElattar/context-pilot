import { detectHooks, type HookInfo } from './hooks.js';
import { detectPlugins } from './plugins.js';
import { detectProxy } from './proxies.js';
import { detectAllTools, type DetectedTool } from '../adapters/registry.js';

export type ConflictSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Conflict {
  id: string;
  severity: ConflictSeverity;
  category: 'hook' | 'proxy' | 'compression' | 'mcp' | 'config';
  title: string;
  description: string;
  tools: string[];
  recommendation: string;
}

export interface ConflictReport {
  conflicts: Conflict[];
  toolCount: number;
  hookCount: number;
}

export async function detectConflicts(): Promise<ConflictReport> {
  const [hookReport, pluginsReport, proxy, tools] = await Promise.all([
    detectHooks(),
    detectPlugins(),
    detectProxy(),
    detectAllTools(),
  ]);

  const conflicts: Conflict[] = [];
  const installedTools = tools.filter(t => t.status === 'installed' || t.status === 'detected');

  // Hook stdout conflicts
  detectHookStdoutConflicts(hookReport.hooks, conflicts);

  // Hook hot-path congestion
  detectHookCongestion(hookReport.hooks, conflicts);

  // Proxy conflicts
  detectProxyConflicts(proxy, conflicts);

  // Compression overlap
  detectCompressionOverlap(installedTools, conflicts);

  // MCP tool name collisions
  detectMcpCollisions(pluginsReport.mcpServers, conflicts);

  // Cross-tool declared conflicts
  detectDeclaredConflicts(installedTools, conflicts);

  return {
    conflicts: conflicts.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity)),
    toolCount: installedTools.length,
    hookCount: hookReport.hooks.length,
  };
}

function detectHookStdoutConflicts(hooks: HookInfo[], conflicts: Conflict[]): void {
  const byEvent = new Map<string, HookInfo[]>();
  for (const hook of hooks) {
    const list = byEvent.get(hook.event) ?? [];
    list.push(hook);
    byEvent.set(hook.event, list);
  }

  for (const [event, eventHooks] of byEvent) {
    const writers = eventHooks.filter(h => h.writesStdout === 'yes' || h.writesStdout === 'unknown');
    if (writers.length > 1) {
      const owners = [...new Set(writers.map(h => h.owner))];
      conflicts.push({
        id: `hook-stdout-${event}`,
        severity: event === 'PreToolUse' ? 'high' : 'medium',
        category: 'hook',
        title: `Multiple stdout writers on ${event}`,
        description: `${writers.length} hooks may write stdout on ${event}. Hooks run in parallel — results merge unpredictably.`,
        tools: owners,
        recommendation: event === 'PreToolUse'
          ? 'Only one tool should modify tool input per event. Disable one.'
          : 'Review which hooks need stdout output on this event.',
      });
    }
  }
}

function detectHookCongestion(hooks: HookInfo[], conflicts: Conflict[]): void {
  const hotPathEvents = ['PreToolUse', 'UserPromptSubmit'];

  for (const event of hotPathEvents) {
    const eventHooks = hooks.filter(h => h.event === event);
    if (eventHooks.length >= 3) {
      conflicts.push({
        id: `hook-congestion-${event}`,
        severity: 'medium',
        category: 'hook',
        title: `${eventHooks.length} hooks on hot-path event ${event}`,
        description: `${eventHooks.length} hooks fire in parallel on ${event}. All must complete before the tool call proceeds. Latency adds up.`,
        tools: [...new Set(eventHooks.map(h => h.owner))],
        recommendation: `Review whether all ${eventHooks.length} hooks are necessary on ${event}. Observer-only hooks should use PostToolUse instead.`,
      });
    }
  }
}

function detectProxyConflicts(proxy: { detected: boolean; url: string | null }, conflicts: Conflict[]): void {
  if (!proxy.url) return;

  const urls = new Set<string>();
  urls.add(proxy.url);

  if (process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_BASE_URL !== proxy.url) {
    urls.add(process.env.ANTHROPIC_BASE_URL);
  }

  if (urls.size > 1) {
    conflicts.push({
      id: 'proxy-multiple-urls',
      severity: 'critical',
      category: 'proxy',
      title: 'Multiple ANTHROPIC_BASE_URL values',
      description: `Settings and environment define different base URLs. Only one proxy can handle API traffic.`,
      tools: ['unknown'],
      recommendation: 'Ensure ANTHROPIC_BASE_URL is set consistently in settings and environment.',
    });
  }
}

function detectCompressionOverlap(tools: DetectedTool[], conflicts: Conflict[]): void {
  const compressors = tools.filter(t => t.capabilities.includes('compression'));
  if (compressors.length > 1) {
    conflicts.push({
      id: 'compression-overlap',
      severity: 'high',
      category: 'compression',
      title: 'Multiple compression tools active',
      description: `${compressors.map(t => t.name).join(' and ')} both perform compression. Double-compression degrades quality and wastes tokens.`,
      tools: compressors.map(t => t.id),
      recommendation: 'Use one compression tool at a time. Disable the other or configure non-overlapping scopes.',
    });
  }
}

function detectMcpCollisions(mcpServers: Array<{ name: string; command: string }>, conflicts: Conflict[]): void {
  const names = mcpServers.map(s => s.name);
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);

  if (duplicates.length > 0) {
    conflicts.push({
      id: 'mcp-name-collision',
      severity: 'medium',
      category: 'mcp',
      title: `Duplicate MCP server names: ${[...new Set(duplicates)].join(', ')}`,
      description: 'Multiple MCP servers registered with the same name. Higher-precedence config wins entirely.',
      tools: ['unknown'],
      recommendation: 'Rename one of the conflicting MCP servers.',
    });
  }
}

function detectDeclaredConflicts(tools: DetectedTool[], conflicts: Conflict[]): void {
  const installed = new Set(tools.map(t => t.id));

  for (const tool of tools) {
    for (const conflict of tool.conflicts) {
      if (installed.has(conflict.withTool)) {
        const pairId = [tool.id, conflict.withTool].sort().join('-');
        if (!conflicts.some(c => c.id === `declared-${pairId}`)) {
          conflicts.push({
            id: `declared-${pairId}`,
            severity: conflict.severity as ConflictSeverity,
            category: 'config',
            title: `${tool.name} conflicts with ${conflict.withTool}`,
            description: conflict.reason,
            tools: [tool.id, conflict.withTool],
            recommendation: `Review ${conflict.withTool} and ${tool.id} configuration for overlap.`,
          });
        }
      }
    }
  }
}

function severityOrder(s: ConflictSeverity): number {
  const order: Record<ConflictSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return order[s];
}
