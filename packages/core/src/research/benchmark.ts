import { researchQuery } from './research.js';
import { safeFetch, type FetchResult } from './fetch.js';
import { parseGitHubRef, fetchGitHubMarkdown, type GhExec } from './github.js';
import type Database from 'better-sqlite3';

const est = (s: string) => Math.ceil(s.length / 4);

export interface ResearchBenchTask {
  id: string;
  query: string;
  urls: string[];
  /** The model must still be able to see this exact text for the task to "resolve". */
  expectAnswerIncludes: string;
}

export interface ArmResult {
  arm: 'native' | 'gateway';
  est_model_tokens: number;
  latency_ms: number;
  resolved: boolean;
}

export interface ResearchBenchTaskResult {
  task_id: string;
  native: ArmResult;
  gateway: ArmResult;
  token_reduction_percent: number;
  resolution_preserved: boolean;
}

export interface ResearchBenchReport {
  task_count: number;
  results: ResearchBenchTaskResult[];
  summary: {
    avg_token_reduction_percent: number;
    native_resolution_rate: number;
    gateway_resolution_rate: number;
    total_native_tokens: number;
    total_gateway_tokens: number;
    note: string;
  };
}

export interface ResearchBenchOptions {
  budget_tokens?: number;
  db?: Database.Database;
  /** Fetcher seam: pass fixtures for offline runs, omit for live SSRF-guarded fetch. */
  fetchImpl?: (url: string) => Promise<FetchResult>;
  ghExec?: GhExec;
}

/**
 * Benchmark the gateway against the naive baseline on bug-hunting tasks. Both
 * arms see the SAME fetched bytes (via `fetchImpl` fixtures offline, or live
 * fetch); the native arm counts the whole raw body as model-visible tokens, the
 * gateway arm counts its ranked, budget-capped evidence. `resolved` is a PROXY:
 * whether the expected answer text is present in what the model would see — not
 * a live `claude -p` task-success measurement. All token figures are estimates.
 */
export async function runResearchBenchmark(
  tasks: ResearchBenchTask[],
  opts: ResearchBenchOptions = {},
): Promise<ResearchBenchReport> {
  const fetcher = opts.fetchImpl ?? safeFetch;
  const results: ResearchBenchTaskResult[] = [];

  for (const task of tasks) {
    // Native baseline: dump every raw body (what a naive WebFetch would ingest).
    const nativeStart = Date.now();
    let rawConcat = '';
    for (const url of task.urls) {
      try {
        const ref = parseGitHubRef(url);
        if (ref) {
          const { markdown } = await fetchGitHubMarkdown(ref, { ghExec: opts.ghExec, fetchImpl: fetcher as any });
          rawConcat += markdown + '\n';
        } else {
          rawConcat += (await fetcher(url)).body + '\n';
        }
      } catch { /* a failed source contributes nothing to the native dump */ }
    }
    const native: ArmResult = {
      arm: 'native',
      est_model_tokens: est(rawConcat),
      latency_ms: Date.now() - nativeStart,
      resolved: rawConcat.includes(task.expectAnswerIncludes),
    };

    // Gateway arm: ranked, budget-capped evidence.
    const gwStart = Date.now();
    const research = await researchQuery({
      query: task.query, urls: task.urls, budget_tokens: opts.budget_tokens,
      db: opts.db, fetchImpl: opts.fetchImpl, ghExec: opts.ghExec,
    });
    const evidenceText = research.evidence.map(e => e.text).join('\n');
    const gateway: ArmResult = {
      arm: 'gateway',
      est_model_tokens: est(JSON.stringify(research)),
      latency_ms: Date.now() - gwStart,
      resolved: evidenceText.includes(task.expectAnswerIncludes),
    };

    const reduction = native.est_model_tokens > 0
      ? Number(((1 - gateway.est_model_tokens / native.est_model_tokens) * 100).toFixed(1))
      : 0;
    results.push({
      task_id: task.id,
      native, gateway,
      token_reduction_percent: reduction,
      resolution_preserved: gateway.resolved || !native.resolved,
    });
  }

  const n = results.length || 1;
  const totalNative = results.reduce((s, r) => s + r.native.est_model_tokens, 0);
  const totalGw = results.reduce((s, r) => s + r.gateway.est_model_tokens, 0);
  return {
    task_count: results.length,
    results,
    summary: {
      avg_token_reduction_percent: Number((results.reduce((s, r) => s + r.token_reduction_percent, 0) / n).toFixed(1)),
      native_resolution_rate: Number((results.filter(r => r.native.resolved).length / n).toFixed(3)),
      gateway_resolution_rate: Number((results.filter(r => r.gateway.resolved).length / n).toFixed(3)),
      total_native_tokens: totalNative,
      total_gateway_tokens: totalGw,
      note: 'Estimated tokens (chars/4). `resolved` is a proxy (expected answer present in model-visible text), NOT live claude -p task success. Run with live URLs / claude -p for a true baseline.',
    },
  };
}
