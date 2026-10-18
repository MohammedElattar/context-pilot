import chalk from 'chalk';
import { runBenchmark, storeBenchmarkReport, runResearchBenchmark, type BenchmarkConfig } from '@contextpilot/core';

interface BenchmarkOptions {
  json?: boolean;
  trials?: string;
  config?: string;
  research?: boolean;
  query?: string;
  urls?: string;
  expect?: string;
  budget?: string;
}

/**
 * Research-gateway benchmark: native raw-dump vs gateway evidence over the same
 * fetched bytes. Needs live egress to fetch the given URLs.
 */
async function runResearchBenchmarkCommand(options: BenchmarkOptions): Promise<void> {
  const urls = (options.urls ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (urls.length === 0) {
    const msg = 'Research benchmark needs --urls <comma-separated URLs or owner/repo#n>, plus --query <text> and --expect <answer substring>. It fetches each URL live (requires network egress) and compares native raw-dump tokens vs gateway evidence tokens.';
    if (options.json) console.log(JSON.stringify({ error: msg }, null, 2));
    else console.log(chalk.yellow(msg));
    return;
  }
  const report = await runResearchBenchmark([
    { id: 'cli', query: options.query ?? '', urls, expectAnswerIncludes: options.expect ?? '' },
  ], { budget_tokens: options.budget ? parseInt(options.budget, 10) : undefined });

  if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log();
  console.log(chalk.bold.underline('ContextPilot Research Benchmark'));
  console.log();
  const r = report.results[0];
  console.log(`  Native (raw dump):   ${r.native.est_model_tokens} est tokens, resolved=${r.native.resolved}`);
  console.log(`  Gateway (evidence):  ${r.gateway.est_model_tokens} est tokens, resolved=${r.gateway.resolved}`);
  console.log(`  Token reduction:     ${chalk.green(r.token_reduction_percent + '%')}`);
  console.log(`  Latency:             native ${r.native.latency_ms}ms, gateway ${r.gateway.latency_ms}ms`);
  console.log();
  console.log(chalk.dim(`  ${report.summary.note}`));
  console.log();
}

export async function runBenchmarkCommand(options: BenchmarkOptions): Promise<void> {
  if (options.research) {
    await runResearchBenchmarkCommand(options);
    return;
  }
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

  // Persist summaries for later baseline comparison (fail-open).
  let stored = 0;
  try { stored = storeBenchmarkReport(report); } catch { /* persistence is best-effort */ }

  if (options.json) {
    console.log(JSON.stringify({ ...report, persisted_rows: stored }, null, 2));
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
