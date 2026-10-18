import chalk from 'chalk';
import {
  detectEnvironment,
  detectProxy,
  readCavemanConfig,
  readCavemanHistory,
  detectAllTools,
  getRecentSessions,
  getSessionCost,
  getCavemanTokenStats,
  computeContextHealth,
  type SessionCost,
  type ContextHealth,
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

  const cost = collectCost(sinceMs);

  let health: ContextHealth | null = null;
  try {
    const latest = getRecentSessions(1);
    if (latest.length > 0) health = computeContextHealth(latest[0].id);
  } catch { /* unavailable */ }

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
      health: health ? { score: health.score, confidence: health.confidence, missing_data: health.missing_data, factors: health.factors } : null,
      cost: {
        estimated: cost.estimated
          ? { usd: cost.estimated.usd, model: cost.estimated.modelId, partial: cost.estimated.partial, pricingVersion: cost.estimated.pricingVersion, kind: 'estimated' }
          : null,
        billed: cost.billedUsd != null ? { usd: cost.billedUsd, source: 'caveman', kind: 'billed' } : null,
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

  // Context Health
  console.log();
  console.log(chalk.bold('Context Health (latest session)'));
  if (health && health.score != null) {
    const col = health.score >= 75 ? chalk.green : health.score >= 50 ? chalk.yellow : chalk.red;
    console.log(`  Score: ${col(`${health.score}/100`)} ${chalk.dim(`(confidence ${(health.confidence * 100).toFixed(0)}%)`)}`);
    for (const f of health.factors) {
      if (f.status === 'unknown') continue;
      const dot = f.status === 'good' ? chalk.green('●') : f.status === 'warn' ? chalk.yellow('●') : chalk.red('●');
      console.log(`  ${dot} ${f.label}: ${chalk.dim(f.detail)}`);
    }
    if (health.missing_data.length > 0) {
      console.log(`  ${chalk.dim(`Missing data: ${health.missing_data.join(', ')}`)}`);
    }
  } else {
    console.log(`  ${chalk.dim('unavailable (no telemetry for latest session)')}`);
  }

  // Cost
  console.log();
  console.log(chalk.bold('Cost'));
  if (cost.estimated) {
    const partial = cost.estimated.partial ? chalk.dim(' (partial — some token kinds unpriced)') : '';
    console.log(`  Estimated (latest session): $${cost.estimated.usd.toFixed(4)} ${chalk.dim('[estimated]')}${partial}`);
    console.log(`    ${chalk.dim(`model ${cost.estimated.modelId}, pricing ${cost.estimated.pricingVersion}`)}`);
  } else {
    console.log(`  Estimated: ${chalk.dim('unavailable (no priced token snapshots)')} ${chalk.dim('[estimated]')}`);
  }
  if (cost.billedUsd != null) {
    console.log(`  Billed (Caveman, last ${days}d): $${cost.billedUsd.toFixed(4)} ${chalk.dim('[billed]')}`);
  } else {
    console.log(`  Billed (Caveman): ${chalk.dim('unavailable')} ${chalk.dim('[billed]')}`);
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

interface CostSummary {
  estimated: SessionCost['estimated'];
  billedUsd: number | null;
}

/** Gather cost figures, fail-open: any error yields unavailable (nulls). */
function collectCost(sinceMs: number): CostSummary {
  let estimated: SessionCost['estimated'] = null;
  let billedUsd: number | null = null;

  try {
    const latest = getRecentSessions(1);
    if (latest.length > 0) {
      estimated = getSessionCost(latest[0].id).estimated;
    }
  } catch { /* unavailable */ }

  try {
    const stats = getCavemanTokenStats(sinceMs);
    if (stats && stats.totalCostUsd > 0) billedUsd = stats.totalCostUsd;
  } catch { /* unavailable */ }

  return { estimated, billedUsd };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
