import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BenchmarkTask, BenchmarkRun, BenchmarkConfig } from './types.js';

const execFileAsync = promisify(execFile);

export async function runBenchmarkTask(
  task: BenchmarkTask,
  config: BenchmarkConfig,
): Promise<BenchmarkRun> {
  const start = Date.now();
  let output = '';
  let exitCode = 0;
  let error: string | undefined;

  try {
    const { stdout, stderr } = await execFileAsync('claude', ['-p', task.prompt], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        CONTEXT_PILOT_BENCHMARK: '1',
        CONTEXT_PILOT_CONFIG: config,
      },
    });
    output = stdout;
    if (stderr) error = stderr.slice(0, 500);
  } catch (err: any) {
    exitCode = err.code ?? 1;
    output = err.stdout ?? '';
    error = err.stderr?.slice(0, 500) ?? err.message;
  }

  const end = Date.now();

  return {
    taskId: task.id,
    config,
    startedAt: start,
    endedAt: end,
    durationMs: end - start,
    exitCode,
    outputLength: output.length,
    outputPreview: output.slice(0, 200),
    error,
  };
}

export const BUILTIN_TASKS: BenchmarkTask[] = [
  {
    id: 'hello',
    name: 'Hello world',
    prompt: 'Reply with exactly: Hello from ContextPilot benchmark',
  },
  {
    id: 'explain-function',
    name: 'Explain a function',
    prompt: 'In one sentence, explain what Array.prototype.reduce does in JavaScript.',
  },
  {
    id: 'code-generation',
    name: 'Generate code',
    prompt: 'Write a TypeScript function that reverses a string. Only output the function, no explanation.',
  },
  {
    id: 'analysis',
    name: 'Code analysis',
    prompt: 'What are the time and space complexities of JavaScript Array.sort()? Answer in one line.',
  },
];
