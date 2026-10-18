import chalk from 'chalk';
import {
  readCavemanHistory,
  readCavemanModeLog,
  getRecentSessions,
  getTokenAggregate,
  getToolUsageStats,
  getSessionCost,
  getCavemanTokenStats,
  type SessionCost,
} from '@contextpilot/core';

interface AnalyzeOptions {
  json?: boolean;
  days?: string;
}

export async function runAnalyze(options: AnalyzeOptions): Promise<void> {
  const days = parseInt(options.days ?? '7', 10);
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const [history, modeLog] = await Promise.all([
    readCavemanHistory(),
    readCavemanModeLog(),
  ]);

  let sessions, tokens, toolStats;
  let cost: SessionCost | null = null;
  try {
    sessions = getRecentSessions(50);
    tokens = getTokenAggregate(sinceMs);
    toolStats = getToolUsageStats(sinceMs);
    if (sessions.length > 0) cost = getSessionCost(sessions[0].id);
  } catch {
    sessions = [];
    tokens = { total_input: 0, total_output: 0, total_cache_read: 0, total_cache_write: 0, snapshot_count: 0 };
    toolStats = [];
  }
  let billedUsd: number | null = null;
  try {
    const cstats = getCavemanTokenStats(sinceMs);
    if (cstats && cstats.totalCostUsd > 0) billedUsd = cstats.totalCostUsd;
  } catch { /* unavailable */ }

  // Caveman history analysis
  const recentHistory = history.filter(h => h.ts >= sinceMs);
  const totalOutputTokens = recentHistory.reduce((sum, h) => sum + h.output_tokens, 0);
  const totalCacheRead = recentHistory.reduce((sum, h) => sum + (h.cache_read_input_tokens ?? 0), 0);
  const totalTurns = recentHistory.reduce((sum, h) => sum + (h.turns ?? 0), 0);

  const modelUsage = new Map<string, number>();
  for (const h of recentHistory) {
    if (h.model) {
      modelUsage.set(h.model, (modelUsage.get(h.model) ?? 0) + h.output_tokens);
    }
  }

  const modeUsage = new Map<string, number>();
  for (const h of recentHistory) {
    if (h.output_tokens_by_mode) {
      for (const [mode, tokens] of Object.entries(h.output_tokens_by_mode)) {
        modeUsage.set(mode, (modeUsage.get(mode) ?? 0) + tokens);
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify({
      period: { days, since: new Date(sinceMs).toISOString() },
      caveman: {
        sessions: recentHistory.length,
        totalOutputTokens,
        totalCacheRead,
        totalTurns,
        modelUsage: Object.fromEntries(modelUsage),
        modeUsage: Object.fromEntries(modeUsage),
      },
      contextpilot: { tokens, toolStats, sessions: sessions.length },
      cost: {
        estimated: cost?.estimated ? { usd: cost.estimated.usd, model: cost.estimated.modelId, partial: cost.estimated.partial, kind: 'estimated' } : null,
        billed: billedUsd != null ? { usd: billedUsd, source: 'caveman', kind: 'billed' } : null,
      },
    }, null, 2));
    return;
  }

  console.log();
  console.log(chalk.bold.underline(`Analysis — Last ${days} Days`));

  // Caveman data
  console.log();
  console.log(chalk.bold('Caveman Session Data'));

  if (recentHistory.length === 0) {
    console.log(`  ${chalk.dim('No session data in this period.')}`);
  } else {
    console.log(`  Sessions: ${recentHistory.length}`);
    console.log(`  Turns: ${totalTurns}`);
    console.log(`  Output tokens: ${formatTokens(totalOutputTokens)}`);
    console.log(`  Cache read tokens: ${formatTokens(totalCacheRead)}`);

    if (totalCacheRead > 0 && totalOutputTokens > 0) {
      const cacheRatio = totalCacheRead / (totalCacheRead + totalOutputTokens);
      console.log(`  Cache ratio: ${(cacheRatio * 100).toFixed(1)}%`);
    }

    // Model breakdown
    if (modelUsage.size > 0) {
      console.log();
      console.log(chalk.bold('  By Model'));
      for (const [model, tokens] of [...modelUsage.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${model}: ${formatTokens(tokens)} output`);
      }
    }

    // Mode breakdown
    if (modeUsage.size > 0) {
      console.log();
      console.log(chalk.bold('  By Mode'));
      for (const [mode, tokens] of [...modeUsage.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${mode}: ${formatTokens(tokens)} output`);
      }
    }
  }

  // ContextPilot telemetry
  if (tokens.snapshot_count > 0 || toolStats.length > 0) {
    console.log();
    console.log(chalk.bold('ContextPilot Telemetry'));

    if (tokens.snapshot_count > 0) {
      console.log(`  Snapshots: ${tokens.snapshot_count}`);
      console.log(`  Total output: ${formatTokens(tokens.total_output)}`);
      console.log(`  Total cache read: ${formatTokens(tokens.total_cache_read)}`);
    }

    if (toolStats.length > 0) {
      console.log();
      console.log(chalk.bold('  Tool Usage'));
      for (const stat of toolStats.slice(0, 10)) {
        const avgMs = stat.avg_duration_ms ? ` (${Math.round(stat.avg_duration_ms)}ms avg)` : '';
        console.log(`    ${stat.tool_name}: ${stat.call_count} calls, ${formatBytes(stat.total_payload_bytes)}${avgMs}`);
      }
    }
  }

  // Cost
  console.log();
  console.log(chalk.bold('Cost'));
  if (cost?.estimated) {
    const partial = cost.estimated.partial ? chalk.dim(' partial') : '';
    console.log(`  Estimated (latest session): $${cost.estimated.usd.toFixed(4)} ${chalk.dim('[estimated]')}${partial}`);
  } else {
    console.log(`  Estimated: ${chalk.dim('unavailable')} ${chalk.dim('[estimated]')}`);
  }
  console.log(`  Billed (Caveman, last ${days}d): ${billedUsd != null ? `$${billedUsd.toFixed(4)}` : chalk.dim('unavailable')} ${chalk.dim('[billed]')}`);

  console.log();
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}KB`;
  return `${n}B`;
}
