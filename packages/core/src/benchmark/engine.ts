import { runBenchmarkTask, BUILTIN_TASKS } from './runner.js';
import type {
  BenchmarkTask,
  BenchmarkConfig,
  BenchmarkRun,
  BenchmarkResult,
  BenchmarkReport,
  BenchmarkComparison,
  BenchmarkSummary,
} from './types.js';

export interface BenchmarkOptions {
  tasks?: BenchmarkTask[];
  configs?: BenchmarkConfig[];
  trials?: number;
  onProgress?: (message: string) => void;
}

export async function runBenchmark(options: BenchmarkOptions = {}): Promise<BenchmarkReport> {
  const tasks = options.tasks ?? BUILTIN_TASKS;
  const configs = options.configs ?? ['native'];
  const trials = options.trials ?? 1;
  const log = options.onProgress ?? (() => {});

  const startedAt = new Date().toISOString();
  const results: BenchmarkResult[] = [];

  for (const task of tasks) {
    for (const config of configs) {
      const runs: BenchmarkRun[] = [];

      for (let trial = 0; trial < trials; trial++) {
        log(`Running ${task.name} [${config}] trial ${trial + 1}/${trials}...`);
        const run = await runBenchmarkTask(task, config);
        runs.push(run);
      }

      results.push({
        task,
        runs,
        summary: summarize(config, runs),
      });
    }
  }

  const comparison = buildComparison(tasks, results);

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    tasks,
    results,
    comparison,
  };
}

function summarize(config: BenchmarkConfig, runs: BenchmarkRun[]): BenchmarkSummary {
  const durations = runs.map(r => r.durationMs).sort((a, b) => a - b);
  const successes = runs.filter(r => r.exitCode === 0);

  return {
    config,
    taskCount: runs.length,
    avgDurationMs: durations.reduce((s, d) => s + d, 0) / durations.length,
    medianDurationMs: durations[Math.floor(durations.length / 2)] ?? 0,
    totalOutputChars: runs.reduce((s, r) => s + r.outputLength, 0),
    successRate: runs.length > 0 ? successes.length / runs.length : 0,
  };
}

function buildComparison(tasks: BenchmarkTask[], results: BenchmarkResult[]): BenchmarkComparison[] {
  return tasks.map(task => {
    const taskResults = results.filter(r => r.task.id === task.id);
    const configs: BenchmarkComparison['configs'] = {};

    for (const result of taskResults) {
      configs[result.summary.config] = {
        avgDurationMs: result.summary.avgDurationMs,
        outputLength: result.summary.totalOutputChars,
        successRate: result.summary.successRate,
      };
    }

    return { taskId: task.id, configs };
  });
}

export { BUILTIN_TASKS };
