import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { paths } from '../config/paths.js';
import type { Policy, PolicyContext, PolicyResult, PolicySeverity, PolicyActionType } from './types.js';

// Numeric metrics a declarative policy can test, mapped to PolicyContext fields.
const NUMERIC_METRICS = {
  context_window_used_percent: (c: PolicyContext) => c.contextWindowUsedPercent,
  cache_read_ratio: (c: PolicyContext) => c.cacheReadRatio,
  session_turns: (c: PolicyContext) => c.sessionTurns,
  tool_call_count: (c: PolicyContext) => c.toolCallCount,
  repeated_file_reads: (c: PolicyContext) => c.repeatedFileReads,
} as const;

export type DeclarativeMetric = keyof typeof NUMERIC_METRICS;

export const DeclarativePolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  metric: z.enum(Object.keys(NUMERIC_METRICS) as [DeclarativeMetric, ...DeclarativeMetric[]]),
  operator: z.enum(['gte', 'gt', 'lte', 'lt', 'eq', 'ne']),
  value: z.number(),
  severity: z.enum(['info', 'warn', 'critical']).default('warn'),
  actionType: z.enum(['suggest', 'compress', 'split-session', 'enable-module', 'reduce-reads']).default('suggest'),
  action: z.string(),
  reason: z.string().optional(),
  /** 0..1 — how confident the rule is when it fires. */
  confidence: z.number().min(0).max(1).default(1),
  /** Higher wins when two triggered policies conflict (for P2-2). */
  priority: z.number().default(0),
}).passthrough();

export type DeclarativePolicy = z.infer<typeof DeclarativePolicySchema>;

export const DeclarativePolicyFileSchema = z.object({
  policies: z.array(DeclarativePolicySchema).default([]),
}).passthrough();

function compare(actual: number, op: DeclarativePolicy['operator'], expected: number): boolean {
  switch (op) {
    case 'gte': return actual >= expected;
    case 'gt': return actual > expected;
    case 'lte': return actual <= expected;
    case 'lt': return actual < expected;
    case 'eq': return actual === expected;
    case 'ne': return actual !== expected;
  }
}

/** Compile a declarative policy into the same Policy interface as code policies. */
export function compileDeclarativePolicy(decl: DeclarativePolicy): Policy {
  return {
    id: decl.id,
    name: decl.name,
    evaluate(ctx: PolicyContext): PolicyResult {
      const metricValue = NUMERIC_METRICS[decl.metric](ctx);
      // Unknown metric data → not triggered (never guess).
      const triggered = decl.enabled && metricValue != null && compare(metricValue, decl.operator, decl.value);
      return {
        id: decl.id,
        name: decl.name,
        severity: (triggered ? decl.severity : 'info') as PolicySeverity,
        triggered,
        action: decl.action,
        actionType: decl.actionType as PolicyActionType,
        reason: decl.reason ?? (metricValue == null
          ? `${decl.metric} unavailable.`
          : `${decl.metric}=${metricValue} ${decl.operator} ${decl.value} is ${triggered ? 'true' : 'false'}.`),
        confidence: triggered ? decl.confidence : undefined,
        priority: decl.priority,
      };
    },
  };
}

export interface ValidationResult {
  ok: boolean;
  count: number;
  errors: string[];
}

/** Parse and validate the declarative policy file without throwing. */
export function validateDeclarativePolicies(raw: unknown): ValidationResult {
  const parsed = DeclarativePolicyFileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, count: 0, errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
  }
  const ids = new Set<string>();
  const errors: string[] = [];
  for (const p of parsed.data.policies) {
    if (ids.has(p.id)) errors.push(`duplicate policy id: ${p.id}`);
    ids.add(p.id);
  }
  return { ok: errors.length === 0, count: parsed.data.policies.length, errors };
}

/**
 * Load declarative policies from ~/.context-pilot/policies.json. Fail-open:
 * a missing or invalid file yields an empty list, never throws.
 */
export function loadDeclarativePolicies(file: string = paths.contextPilot.policies): Policy[] {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const parsed = DeclarativePolicyFileSchema.safeParse(raw);
    if (!parsed.success) return [];
    return parsed.data.policies.map(compileDeclarativePolicy);
  } catch {
    return [];
  }
}
