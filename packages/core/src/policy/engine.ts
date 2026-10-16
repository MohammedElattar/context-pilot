import type { PolicyContext, PolicyResult } from './types.js';
import { ALL_POLICIES } from './policies.js';

export function evaluatePolicies(ctx: PolicyContext): PolicyResult[] {
  return ALL_POLICIES.map(policy => policy.evaluate(ctx));
}

export function getTriggeredPolicies(ctx: PolicyContext): PolicyResult[] {
  return evaluatePolicies(ctx).filter(r => r.triggered);
}

export function buildPolicyContext(options: {
  contextWindowUsedPercent?: number;
  cacheReadRatio?: number;
  sessionTurns?: number;
  toolCallCount?: number;
  repeatedFileReads?: number;
  cavemanEnabled?: boolean;
  cavemanCompressingOutput?: boolean;
  currentMode?: string;
}): PolicyContext {
  return {
    contextWindowUsedPercent: options.contextWindowUsedPercent ?? null,
    cacheReadRatio: options.cacheReadRatio ?? null,
    sessionTurns: options.sessionTurns ?? 0,
    toolCallCount: options.toolCallCount ?? 0,
    repeatedFileReads: options.repeatedFileReads ?? 0,
    cavemanEnabled: options.cavemanEnabled ?? false,
    cavemanCompressingOutput: options.cavemanCompressingOutput ?? false,
    currentMode: options.currentMode ?? 'observe',
  };
}
