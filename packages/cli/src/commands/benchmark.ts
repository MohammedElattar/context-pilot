import chalk from 'chalk';
import { runBenchmark, type BenchmarkConfig } from '@contextpilot/core';

interface BenchmarkOptions {
  json?: boolean;
  trials?: string;
  config?: string;
}

export async function runBenchmarkCommand(options: BenchmarkOptions): Promise<void> {
  const trials = parseInt(options.trials ?? '1', 10);
  const configs: BenchmarkConfig[] = options.config
    ? (options.config.split(',') as BenchmarkConfig[])
    : ['native'];

  console.log();
  console.log(chalk.bold.underline('ContextPilot Benchmark'));
  console.log();
  console.log(`Configs: ${configs.join(', ')}`);
  console.log(`Trials per task: ${trials}`);
  console.log();

  const report = await runBenchmark({
    configs,
    trials,
    onProgress: (msg) => console.log(`  ${chalk.dim(msg)}`),
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log();
  console.log(chalk.bold('Results'));
  console.log();

  for (const result of report.results) {
    const s = result.summary;
    const status = s.successRate === 1 ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${status} ${result.task.name} [${s.config}]`);
    console.log(`    Duration: ${Math.round(s.avgDurationMs)}ms avg, ${Math.round(s.medianDurationMs)}ms median`);
    console.log(`    Output: ${s.totalOutputChars} chars`);
    console.log(`    Success: ${(s.successRate * 100).toFixed(0)}%`);

    if (result.runs.some(r => r.error)) {
      const errors = result.runs.filter(r => r.error);
      console.log(`    ${chalk.red('Errors:')} ${errors.length}`);
      for (const r of errors) {
        console.log(`      ${chalk.dim(r.error?.slice(0, 100) ?? '')}`);
      }
    }
    console.log();
  }

  // Comparison table
  if (report.comparison.length > 0 && configs.length > 1) {
    console.log(chalk.bold('Comparison'));
    console.log();

    for (const comp of report.comparison) {
      console.log(`  ${comp.taskId}:`);
      for (const [config, data] of Object.entries(comp.configs)) {
        console.log(`    ${config}: ${Math.round(data.avgDurationMs)}ms, ${data.outputLength} chars, ${(data.successRate * 100).toFixed(0)}% success`);
      }
    }
    console.log();
  }

  console.log(chalk.dim(`Started: ${report.startedAt}`));
  console.log(chalk.dim(`Completed: ${report.completedAt}`));
  console.log();
}
