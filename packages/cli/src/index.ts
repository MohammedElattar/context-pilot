#!/usr/bin/env node
import { Command } from 'commander';
import { runDoctor } from './commands/doctor.js';
import { runStatus } from './commands/status.js';
import { runAnalyze } from './commands/analyze.js';
import { runTools } from './commands/tools.js';

const program = new Command();

program
  .name('context-pilot')
  .description('Local-first token-optimization control plane for Claude Code')
  .version('0.1.0');

program
  .command('doctor')
  .description('Inspect environment, Claude Code, Caveman, hooks, and potential conflicts')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      await runDoctor(options);
    } catch (err) {
      console.error('Doctor failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show current optimization state and recent telemetry')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      await runStatus(options);
    } catch (err) {
      console.error('Status failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Analyze token usage patterns from Caveman and ContextPilot telemetry')
  .option('--json', 'Output as JSON')
  .option('--days <days>', 'Analysis period in days', '7')
  .action(async (options) => {
    try {
      await runAnalyze(options);
    } catch (err) {
      console.error('Analyze failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('tools')
  .description('List detected optimization tools, capabilities, and conflicts')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      await runTools(options);
    } catch (err) {
      console.error('Tools failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
