export interface BenchmarkTask {
  id: string;
  name: string;
  prompt: string;
  expectedBehavior?: string;
}

export type BenchmarkConfig = 'native' | 'caveman' | 'caveman-compressed';

export interface BenchmarkRun {
  taskId: string;
  config: BenchmarkConfig;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  exitCode: number;
  outputLength: number;
  outputPreview: string;
  error?: string;
}

export interface BenchmarkResult {
  task: BenchmarkTask;
  runs: BenchmarkRun[];
  summary: BenchmarkSummary;
}

export interface BenchmarkSummary {
  config: BenchmarkConfig;
  taskCount: number;
  avgDurationMs: number;
  medianDurationMs: number;
  totalOutputChars: number;
  successRate: number;
}

export interface BenchmarkReport {
  startedAt: string;
  completedAt: string;
  tasks: BenchmarkTask[];
  results: BenchmarkResult[];
  comparison: BenchmarkComparison[];
}

export interface BenchmarkComparison {
  taskId: string;
  configs: Record<string, {
    avgDurationMs: number;
    outputLength: number;
    successRate: number;
  }>;
}
