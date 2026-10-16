import chalk from 'chalk';
import {
  buildPolicyContext,
  getTriggeredPolicies,
  evaluatePolicies,
  detectProxy,
  readCavemanConfig,
  loadConfig,
  openReadOnly,
  getRecentSessions,
  getToolUsageStats,
  paths,
} from '@contextpilot/core';
import { printSection } from '../formatters/table.js';

export async function runPolicies(opts: { json?: boolean }) {
  const [proxy, cavemanConfig, config] = await Promise.all([
    detectProxy(),
    readCavemanConfig(),
    Promise.resolve(loadConfig()),
  ]);

  let sessionTurns = 0;
  let toolCallCount = 0;
  let repeatedFileReads = 0;

  try {
    const db = openReadOnly(paths.contextPilot.telemetryDb);
    const sessions = getRecentSessions(db, 1);
    if (sessions.length > 0) {
      sessionTurns = sessions[0].eventCount;
    }
    const toolStats = getToolUsageStats(db);
    toolCallCount = toolStats.reduce((s, t) => s + t.count, 0);
    repeatedFileReads = toolStats.filter(t => t.toolName === 'Read' && t.count > 1).length;
    db.close();
  } catch {
    // telemetry DB may not exist yet
  }

  const cavemanEnabled = proxy.detected;
  const cavemanCompressingOutput = cavemanConfig !== null &&
    Array.isArray(cavemanConfig.modules) &&
    cavemanConfig.modules.includes('output');

  const ctx = buildPolicyContext({
    sessionTurns,
    toolCallCount,
    repeatedFileReads,
    cavemanEnabled,
    cavemanCompressingOutput,
    currentMode: config.mode,
  });

  const allResults = evaluatePolicies(ctx);
  const triggered = getTriggeredPolicies(ctx);

  if (opts.json) {
    console.log(JSON.stringify({ context: ctx, results: allResults, triggered }, null, 2));
    return;
  }

  printSection('Policy Evaluation');

  console.log(chalk.dim('  Context:'));
  console.log(`    Mode: ${config.mode}`);
  console.log(`    Caveman: ${cavemanEnabled ? 'enabled' : 'not detected'}`);
  console.log(`    Tool calls: ${toolCallCount}`);
  console.log(`    Session turns: ${sessionTurns}`);
  console.log();

  if (triggered.length === 0) {
    console.log(chalk.green('  ✓ All policies pass. No action needed.'));
  } else {
    for (const r of triggered) {
      const icon = r.severity === 'critical' ? chalk.red('✗') :
        r.severity === 'warn' ? chalk.yellow('!') : chalk.blue('i');
      console.log(`  ${icon} ${chalk.bold(r.name)}`);
      console.log(`    ${r.reason}`);
      console.log(`    ${chalk.dim('→')} ${r.action}`);
      console.log();
    }
  }

  console.log(chalk.dim(`  ${allResults.length} policies evaluated, ${triggered.length} triggered`));
}
