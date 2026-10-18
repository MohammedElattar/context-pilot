export type PolicySeverity = 'info' | 'warn' | 'critical';

export type PolicyActionType =
  | 'suggest'
  | 'compress'
  | 'split-session'
  | 'enable-module'
  | 'reduce-reads';

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
  actionType: PolicyActionType;
  reason: string;
  /** 0..1 confidence when triggered (declarative policies); optional. */
  confidence?: number;
  /** Conflict-resolution priority; higher wins. Optional. */
  priority?: number;
}

export interface Policy {
  id: string;
  name: string;
  evaluate(ctx: PolicyContext): PolicyResult;
}
