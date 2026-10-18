import type Database from 'better-sqlite3';
import { getDb } from '../db/connection.js';
import type { BenchmarkReport } from './types.js';

export interface BenchmarkRunRecord {
  id: number;
  started_at: string;
  completed_at: string;
  config: string;
  task_id: string;
  task_name: string;
  avg_duration_ms: number;
  median_duration_ms: number;
  total_output_chars: number;
  success_rate: number;
}

/**
 * Persist a benchmark report as one row per (task, config) summary so results
 * can be compared to later baselines. Returns the number of rows written.
 */
export function storeBenchmarkReport(report: BenchmarkReport, db?: Database.Database): number {
  const d = db ?? getDb();
  const insert = d.prepare(`
    INSERT INTO benchmark_runs
      (started_at, completed_at, config, task_id, task_name, avg_duration_ms, median_duration_ms, total_output_chars, success_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = d.transaction((results: BenchmarkReport['results']) => {
    let n = 0;
    for (const r of results) {
      insert.run(
        report.startedAt, report.completedAt, r.summary.config,
        r.task.id, r.task.name,
        r.summary.avgDurationMs, r.summary.medianDurationMs,
        r.summary.totalOutputChars, r.summary.successRate,
      );
      n++;
    }
    return n;
  });
  return tx(report.results);
}

/** Most recent benchmark summary rows, newest first. */
export function getRecentBenchmarks(limit = 50, db?: Database.Database): BenchmarkRunRecord[] {
  const d = db ?? getDb();
  return d
    .prepare('SELECT * FROM benchmark_runs ORDER BY id DESC LIMIT ?')
    .all(limit) as BenchmarkRunRecord[];
}
