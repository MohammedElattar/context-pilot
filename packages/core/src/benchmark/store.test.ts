import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, closeDb } from '../db/connection.js';
import { storeBenchmarkReport, getRecentBenchmarks } from './store.js';
import type { BenchmarkReport } from './types.js';

function sampleReport(taskId: string): BenchmarkReport {
  return {
    startedAt: new Date(1000).toISOString(),
    completedAt: new Date(2000).toISOString(),
    tasks: [{ id: taskId, name: `Task ${taskId}`, prompt: 'hi' }],
    results: [{
      task: { id: taskId, name: `Task ${taskId}`, prompt: 'hi' },
      runs: [],
      summary: { config: 'native', taskCount: 1, avgDurationMs: 120, medianDurationMs: 110, totalOutputChars: 42, successRate: 1 },
    }],
    comparison: [],
  };
}

describe('benchmark persistence (migration 006)', () => {
  beforeEach(() => {
    getDb().prepare("DELETE FROM benchmark_runs WHERE task_id LIKE ?").run('bench-%');
  });
  afterEach(() => {
    getDb().prepare("DELETE FROM benchmark_runs WHERE task_id LIKE ?").run('bench-%');
    closeDb();
  });

  it('migration 006 created benchmark_runs', () => {
    const tables = (getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(t => t.name);
    expect(tables).toContain('benchmark_runs');
  });

  it('stores one row per task/config summary and reads it back', () => {
    const n = storeBenchmarkReport(sampleReport('bench-1'));
    expect(n).toBe(1);
    const rows = getRecentBenchmarks(50).filter(r => r.task_id === 'bench-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].config).toBe('native');
    expect(rows[0].avg_duration_ms).toBe(120);
    expect(rows[0].success_rate).toBe(1);
  });

  it('returns most recent first', () => {
    storeBenchmarkReport(sampleReport('bench-a'));
    storeBenchmarkReport(sampleReport('bench-b'));
    const rows = getRecentBenchmarks(50).filter(r => r.task_id.startsWith('bench-'));
    expect(rows[0].task_id).toBe('bench-b');
  });
});
