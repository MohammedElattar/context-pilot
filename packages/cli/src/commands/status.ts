import chalk from 'chalk';
import {
  detectProxy,
  readCavemanConfig,
  getRecentSessions,
  getTokenAggregate,
  getSessionCost,
  type SessionCost,
} from '@contextpilot/core';

interface StatusOptions {
  json?: boolean;
}

export async function runStatus(options: StatusOptions): Promise<void> {
  const [proxy, cavemanConfig] = await Promise.all([
    detectProxy(),
    readCavemanConfig(),
  ]);

  let sessions, tokens;
  let cost: SessionCost | null = null;
  try {
    sessions = getRecentSessions(5);
    tokens = getTokenAggregate();
    if (sessions.length > 0) cost = getSessionCost(sessions[0].id);
  } catch {
    sessions = [];
    tokens = { total_input: 0, total_output: 0, total_cache_read: 0, total_cache_write: 0, snapshot_count: 0 };
  }

  if (options.json) {
    console.log(JSON.stringify({ proxy, caveman: cavemanConfig, sessions, tokens, cost }, null, 2));
    return;
  }

  console.log();
  console.log(chalk.bold.underline('ContextPilot Status'));
  console.log();

  // Proxy
  if (proxy.detected) {
    const status = proxy.running ? chalk.green('running') : chalk.red('stopped');
    console.log(`  Proxy: ${status} (${proxy.owner}, port ${proxy.port ?? '?'})`);
    if (proxy.mode) console.log(`  Mode: ${proxy.mode}`);
  } else {
    console.log(`  Proxy: ${chalk.dim('none detected')}`);
  }

  // Caveman
  if (cavemanConfig.installed) {
    console.log(`  Caveman: ${chalk.green('installed')} (${cavemanConfig.plan ?? 'unknown'} plan)`);
    if (cavemanConfig.telemetryTokens) {
      const { tokensIn, tokensSaved } = cavemanConfig.telemetryTokens;
      console.log(`  Tokens: ${formatTokens(tokensIn)} in, ${formatTokens(tokensSaved)} saved`);
    }
  }

  // ContextPilot telemetry
  console.log();
  console.log(chalk.bold('Telemetry'));

  if (tokens.snapshot_count > 0) {
    console.log(`  Token snapshots: ${tokens.snapshot_count}`);
    console.log(`  Input: ${formatTokens(tokens.total_input)}`);
    console.log(`  Output: ${formatTokens(tokens.total_output)}`);
    console.log(`  Cache read: ${formatTokens(tokens.total_cache_read)}`);
  } else if (sessions.length === 0) {
    console.log(`  ${chalk.dim('No telemetry data yet. Observer hooks collect data during Claude Code sessions.')}`);
  } else {
    console.log(`  Sessions tracked: ${sessions.length}`);
    const totalEvents = sessions.reduce((sum, s) => sum + s.event_count, 0);
    console.log(`  Events recorded: ${totalEvents}`);
  }

  // Cost (latest session)
  if (cost) {
    console.log();
    console.log(chalk.bold('Cost (latest session)'));
    if (cost.estimated) {
      const partial = cost.estimated.partial ? chalk.dim(' partial') : '';
      console.log(`  Estimated: $${cost.estimated.usd.toFixed(4)} ${chalk.dim('[estimated]')}${partial}`);
    } else {
      console.log(`  Estimated: ${chalk.dim('unavailable')} ${chalk.dim('[estimated]')}`);
    }
    console.log(`  Billed (Caveman): ${cost.billed ? `$${cost.billed.usd.toFixed(4)}` : chalk.dim('unavailable')} ${chalk.dim('[billed]')}`);
  }

  // Recent sessions
  if (sessions.length > 0) {
    console.log();
    console.log(chalk.bold('Recent Sessions'));
    for (const s of sessions) {
      const dur = s.ended_at ? `${Math.round((s.ended_at - s.started_at) / 1000)}s` : 'active';
      const model = s.model ?? 'unknown';
      console.log(`  ${chalk.dim(s.id.slice(0, 8))} ${model} ${dur} (${s.event_count} events)`);
    }
  }

  console.log();
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
