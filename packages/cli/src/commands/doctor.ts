import {
  detectEnvironment,
  detectHooks,
  detectPlugins,
  detectProxy,
  readCavemanConfig,
  readCavemanIntegration,
  readCavemanHistory,
} from '@contextpilot/core';
import {
  printSection,
  printConflicts,
  printRecommendations,
  type CheckResult,
} from '../formatters/table.js';

interface DoctorOptions {
  json?: boolean;
}

export async function runDoctor(options: DoctorOptions): Promise<void> {
  const [env, hookReport, pluginsReport, proxy, cavemanConfig, cavemanIntegration, history] =
    await Promise.all([
      detectEnvironment(),
      detectHooks(),
      detectPlugins(),
      detectProxy(),
      readCavemanConfig(),
      readCavemanIntegration(),
      readCavemanHistory(),
    ]);

  if (options.json) {
    console.log(JSON.stringify({
      environment: env,
      hooks: hookReport,
      plugins: pluginsReport,
      proxy,
      caveman: {
        config: cavemanConfig,
        integration: cavemanIntegration,
        sessionCount: history.length,
      },
    }, null, 2));
    return;
  }

  // System
  printSection('System', [
    { status: 'info', label: 'OS', value: `${env.os.type} ${env.os.release} (${env.os.arch})` },
    { status: 'info', label: 'Shell', value: env.shell ?? 'unknown' },
    { status: 'info', label: 'Node', value: `${env.node.version}` },
  ]);

  // Claude Code
  const claudeChecks: CheckResult[] = [
    {
      status: env.claudeCode.installed ? 'ok' : 'error',
      label: 'Installed',
      value: env.claudeCode.installed
        ? `v${env.claudeCode.version}`
        : 'not found',
    },
    {
      status: env.claudeCode.settingsExists ? 'ok' : 'warn',
      label: 'Settings',
      value: env.claudeCode.settingsExists ? env.claudeCode.settingsPath : 'not found',
    },
  ];

  if (env.claudeCode.model) {
    claudeChecks.push({
      status: 'info',
      label: 'Model',
      value: env.claudeCode.model,
    });
  }

  if (env.claudeCode.anthropicBaseUrl) {
    claudeChecks.push({
      status: 'info',
      label: 'Base URL',
      value: redactUrl(env.claudeCode.anthropicBaseUrl),
    });
  }

  printSection('Claude Code', claudeChecks);

  // Hooks
  const hookChecks: CheckResult[] = [];
  const eventCounts = hookReport.totalByEvent;
  const totalHooks = hookReport.hooks.length;

  hookChecks.push({
    status: totalHooks > 0 ? 'ok' : 'info',
    label: 'Total hooks',
    value: `${totalHooks} across ${Object.keys(eventCounts).length} events`,
  });

  const cavemanHooks = hookReport.hooks.filter(h => h.owner === 'caveman');
  if (cavemanHooks.length > 0) {
    hookChecks.push({
      status: 'ok',
      label: 'Caveman hooks',
      value: `${cavemanHooks.length} hooks on ${new Set(cavemanHooks.map(h => h.event)).size} events`,
    });
  }

  const otherHooks = hookReport.hooks.filter(h => h.owner === 'unknown');
  if (otherHooks.length > 0) {
    hookChecks.push({
      status: 'info',
      label: 'Other hooks',
      value: `${otherHooks.length} hooks`,
      detail: otherHooks.map(h => `${h.event}: ${truncateCommand(h.command)}`).join(', '),
    });
  }

  printSection('Hooks', hookChecks);

  // Plugins & MCP
  const pluginChecks: CheckResult[] = [];

  for (const plugin of pluginsReport.plugins) {
    pluginChecks.push({
      status: plugin.enabled ? 'ok' : 'skip',
      label: 'Plugin',
      value: `${plugin.id} (${plugin.enabled ? 'enabled' : 'disabled'})`,
    });
  }

  for (const mcp of pluginsReport.mcpServers) {
    pluginChecks.push({
      status: 'ok',
      label: 'MCP',
      value: `${mcp.name} (${mcp.type})`,
      detail: truncateCommand(mcp.command),
    });
  }

  if (pluginChecks.length === 0) {
    pluginChecks.push({ status: 'info', label: 'Plugins', value: 'none detected' });
  }

  printSection('Plugins & MCP', pluginChecks);

  // Caveman
  const cavemanChecks: CheckResult[] = [];

  cavemanChecks.push({
    status: cavemanConfig.installed ? 'ok' : 'skip',
    label: 'Installed',
    value: cavemanConfig.installed ? 'yes' : 'no',
  });

  if (cavemanConfig.installed) {
    const version = proxy.version ?? cavemanIntegration.packVersion;
    if (version) {
      cavemanChecks.push({
        status: 'ok',
        label: 'Version',
        value: version.startsWith('v') || version.startsWith('bin-v') ? version : `v${version}`,
      });
    }

    cavemanChecks.push({
      status: cavemanConfig.entitled ? 'ok' : 'warn',
      label: 'Plan',
      value: `${cavemanConfig.plan ?? 'unknown'} (${cavemanConfig.entitled ? 'active' : 'expired'})`,
      detail: cavemanConfig.expiresAt ? `expires ${cavemanConfig.expiresAt}` : undefined,
    });

    // Proxy status
    cavemanChecks.push({
      status: proxy.running ? 'ok' : 'warn',
      label: 'Proxy',
      value: proxy.running
        ? `running on port ${proxy.port} (PID ${proxy.pid})`
        : 'not running',
      detail: proxy.mode ? `mode: ${proxy.mode}` : undefined,
    });

    // Modules
    const enabledModules = Object.entries(cavemanConfig.modules)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const disabledModules = Object.entries(cavemanConfig.modules)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    cavemanChecks.push({
      status: 'info',
      label: 'Modules',
      value: enabledModules.length > 0
        ? `enabled: ${enabledModules.join(', ')}`
        : 'none enabled',
      detail: disabledModules.length > 0
        ? `disabled: ${disabledModules.join(', ')}`
        : undefined,
    });

    // Token stats
    if (cavemanConfig.telemetryTokens) {
      const { tokensIn, tokensSaved } = cavemanConfig.telemetryTokens;
      cavemanChecks.push({
        status: 'info',
        label: 'Tokens',
        value: `${formatTokens(tokensIn)} in, ${formatTokens(tokensSaved)} saved`,
      });
    }

    // MCP integration
    cavemanChecks.push({
      status: cavemanIntegration.mcpInstalled ? 'ok' : 'skip',
      label: 'MCP',
      value: cavemanIntegration.mcpInstalled ? 'registered' : 'not registered',
    });

    // Session history
    cavemanChecks.push({
      status: 'info',
      label: 'History',
      value: `${history.length} sessions tracked`,
    });
  }

  printSection('Caveman', cavemanChecks);

  // Conflicts
  printConflicts(hookReport.conflicts);

  // Recommendations
  const recs: string[] = [];

  if (!env.claudeCode.installed) {
    recs.push('Install Claude Code to use ContextPilot optimizations.');
  }

  if (!cavemanConfig.installed) {
    recs.push('Install Caveman for compression and token savings.');
  } else {
    if (!proxy.running) {
      recs.push('Caveman proxy is not running. Start it for API interception.');
    }
    if (!cavemanConfig.entitled) {
      recs.push('Caveman entitlement expired. Renew for full functionality.');
    }
  }

  if (hookReport.conflicts.length > 0) {
    recs.push('Resolve hook conflicts to prevent output overwrites.');
  }

  printRecommendations(recs);

  console.log();
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function truncateCommand(cmd: string): string {
  if (cmd.length <= 80) return cmd;
  return cmd.slice(0, 77) + '...';
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}
