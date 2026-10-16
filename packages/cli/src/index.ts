#!/usr/bin/env node
import { Command } from 'commander';
import { runDoctor } from './commands/doctor.js';
import { runStatus } from './commands/status.js';
import { runAnalyze } from './commands/analyze.js';
import { runTools } from './commands/tools.js';
import { runReport } from './commands/report.js';
import { runMode } from './commands/mode.js';
import { runBenchmarkCommand } from './commands/benchmark.js';
import { runRollback } from './commands/rollback.js';
import { runPolicies } from './commands/policies.js';
import { runDashboard } from './commands/dashboard.js';

const program = new Command();

program
  .name('context-pilot')
  .description('Local-first token-optimization control plane for Claude Code')
  .version('0.1.0');

program.command('doctor')
  .description('Inspect environment, Claude Code, Caveman, hooks, and potential conflicts')
  .option('--json', 'Output as JSON')
  .action(wrap(runDoctor));

program.command('status')
  .description('Show current optimization state and recent telemetry')
  .option('--json', 'Output as JSON')
  .action(wrap(runStatus));

program.command('analyze')
  .description('Analyze token usage patterns from Caveman and ContextPilot telemetry')
  .option('--json', 'Output as JSON')
  .option('--days <days>', 'Analysis period in days', '7')
  .action(wrap(runAnalyze));

program.command('tools')
  .description('List detected optimization tools, capabilities, and conflicts')
  .option('--json', 'Output as JSON')
  .action(wrap(runTools));

program.command('report')
  .description('Generate a comprehensive optimization report')
  .option('--json', 'Output as JSON')
  .option('--days <days>', 'Analysis period in days', '7')
  .action(wrap(runReport));

program.command('mode [name]')
  .description('Show or set operating mode (observe, canary, auto)')
  .option('--json', 'Output as JSON')
  .action(wrap(runMode));

program.command('benchmark')
  .description('Run token optimization benchmarks via claude -p')
  .option('--json', 'Output as JSON')
  .option('--trials <n>', 'Number of trials per task', '1')
  .option('--config <configs>', 'Comma-separated configs: native,caveman', 'native')
  .action(wrap(runBenchmarkCommand));

program.command('policies')
  .description('Evaluate optimization policies against current telemetry')
  .option('--json', 'Output as JSON')
  .action(wrap(runPolicies));

program.command('dashboard')
  .description('Start local web dashboard for telemetry visualization')
  .option('--port <port>', 'HTTP port', '3141')
  .action(wrap(runDashboard));

program.command('rollback')
  .description('Roll back to observe mode, disabling all active optimizations')
  .option('--json', 'Output as JSON')
  .action(wrap(runRollback));

program.parse();

function wrap(fn: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  };
}
