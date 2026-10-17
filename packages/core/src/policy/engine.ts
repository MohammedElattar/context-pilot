import type { PolicyContext, PolicyResult, PolicyActionType } from './types.js';
import { ALL_POLICIES } from './policies.js';

export interface ModeAction {
  policyId: string;
  actionType: PolicyActionType;
  action: string;
  severity: string;
}

export function evaluatePolicies(ctx: PolicyContext): PolicyResult[] {
  return ALL_POLICIES.map(policy => policy.evaluate(ctx));
}

export function getTriggeredPolicies(ctx: PolicyContext): PolicyResult[] {
  return evaluatePolicies(ctx).filter(r => r.triggered);
}

export function getActionsForMode(mode: string, results: PolicyResult[]): ModeAction[] {
  const triggered = results.filter(r => r.triggered);
  if (triggered.length === 0) return [];

  switch (mode) {
    case 'observe':
      return [];
    case 'canary':
      return triggered
        .filter(r => r.actionType === 'suggest' || r.severity === 'warn' || r.severity === 'critical')
        .map(r => ({ policyId: r.id, actionType: r.actionType, action: r.action, severity: r.severity }));
    case 'auto':
      return triggered
        .map(r => ({ policyId: r.id, actionType: r.actionType, action: r.action, severity: r.severity }));
    default:
      return [];
  }
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
