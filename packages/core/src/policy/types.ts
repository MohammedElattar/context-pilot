export type PolicySeverity = 'info' | 'warn' | 'critical';

export interface PolicyContext {
  contextWindowUsedPercent: number | null;
  cacheReadRatio: number | null;
  sessionTurns: number;
  toolCallCount: number;
  repeatedFileReads: number;
  cavemanEnabled: boolean;
  cavemanCompressingOutput: boolean;
  currentMode: string;
}

export interface PolicyResult {
  id: string;
  name: string;
  severity: PolicySeverity;
  triggered: boolean;
  action: string;
  reason: string;
}

export interface Policy {
  id: string;
  name: string;
  evaluate(ctx: PolicyContext): PolicyResult;
}
