import chalk from 'chalk';
import {
  detectEnvironment,
  detectProxy,
  readCavemanConfig,
  readCavemanHistory,
  detectAllTools,
} from '@contextpilot/core';
import { detectConflicts } from '@contextpilot/core';

interface ReportOptions {
  json?: boolean;
  days?: string;
}

export async function runReport(options: ReportOptions): Promise<void> {
  const days = parseInt(options.days ?? '7', 10);
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const [env, proxy, caveman, history, tools, conflictReport] = await Promise.all([
    detectEnvironment(),
    detectProxy(),
    readCavemanConfig(),
    readCavemanHistory(),
    detectAllTools(),
    detectConflicts(),
  ]);

  const recentHistory = history.filter(h => h.ts >= sinceMs);
  const totalOutput = recentHistory.reduce((s, h) => s + h.output_tokens, 0);
  const totalCacheRead = recentHistory.reduce((s, h) => s + (h.cache_read_input_tokens ?? 0), 0);
  const totalTurns = recentHistory.reduce((s, h) => s + (h.turns ?? 0), 0);

  if (options.json) {
    console.log(JSON.stringify({
      generated: new Date().toISOString(),
      period: { days, since: new Date(sinceMs).toISOString() },
      environment: env,
      proxy,
      caveman,
      tools,
      conflicts: conflictReport,
      usage: {
        sessions: recentHistory.length,
        turns: totalTurns,
        outputTokens: totalOutput,
        cacheReadTokens: totalCacheRead,
        cacheRatio: totalCacheRead > 0 ? totalCacheRead / (totalCacheRead + totalOutput) : 0,
      },
    }, null, 2));
    return;
  }

  console.log();
  console.log(chalk.bold.underline(`ContextPilot Report — ${new Date().toLocaleDateString()}`));

  // Environment
  console.log();
  console.log(chalk.bold('Environment'));
  console.log(`  Claude Code: v${env.claudeCode.version ?? 'unknown'} (${env.claudeCode.model ?? 'no model'})`);
  console.log(`  OS: ${env.os.type} ${env.os.release} (${env.os.arch})`);
  console.log(`  Node: ${env.node.version}`);

  // Optimization stack
  console.log();
  console.log(chalk.bold('Optimization Stack'));
  const installed = tools.filter(t => t.status === 'installed');
  if (installed.length === 0) {
    console.log(`  ${chalk.dim('No optimization tools detected.')}`);
  } else {
    for (const tool of installed) {
      const ver = tool.version ? ` v${tool.version}` : '';
      const health = tool.healthy ? chalk.green('●') : chalk.red('●');
      console.log(`  ${health} ${tool.name}${ver}`);
    }
  }

  // Proxy
  if (proxy.detected) {
    console.log();
    console.log(chalk.bold('Proxy'));
    console.log(`  ${proxy.running ? chalk.green('Running') : chalk.red('Stopped')} on port ${proxy.port ?? '?'} (${proxy.owner}, mode: ${proxy.mode ?? '?'})`);
  }

  // Usage
  console.log();
  console.log(chalk.bold(`Usage — Last ${days} Days`));
  if (recentHistory.length > 0) {
    console.log(`  Sessions: ${recentHistory.length}`);
    console.log(`  Turns: ${totalTurns}`);
    console.log(`  Output: ${fmt(totalOutput)}`);
    console.log(`  Cache read: ${fmt(totalCacheRead)}`);
    if (totalCacheRead > 0) {
      console.log(`  Cache ratio: ${((totalCacheRead / (totalCacheRead + totalOutput)) * 100).toFixed(1)}%`);
    }
    if (caveman.telemetryTokens) {
      console.log(`  Caveman lifetime: ${fmt(caveman.telemetryTokens.tokensIn)} in, ${fmt(caveman.telemetryTokens.tokensSaved)} saved`);
    }
  } else {
    console.log(`  ${chalk.dim('No session data in this period.')}`);
  }

  // Conflicts
  console.log();
  console.log(chalk.bold('Conflicts'));
  if (conflictReport.conflicts.length === 0) {
    console.log(`  ${chalk.green('✓')} No conflicts detected.`);
  } else {
    for (const c of conflictReport.conflicts) {
      const sevColor = c.severity === 'critical' || c.severity === 'high' ? chalk.red : chalk.yellow;
      console.log(`  ${sevColor(`[${c.severity}]`)} ${c.title}`);
      console.log(`    ${chalk.dim(c.description)}`);
      console.log(`    ${chalk.blue('→')} ${c.recommendation}`);
    }
  }

  console.log();
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
