import type { Policy, PolicyContext, PolicyResult } from './types.js';

const highContextPressure: Policy = {
  id: 'high-context-pressure',
  name: 'High context window usage',
  evaluate(ctx: PolicyContext): PolicyResult {
    const triggered = ctx.contextWindowUsedPercent !== null && ctx.contextWindowUsedPercent > 80;
    return {
      id: this.id,
      name: this.name,
      severity: triggered ? 'warn' : 'info',
      triggered,
      action: ctx.cavemanEnabled
        ? 'Consider enabling Caveman output compression module.'
        : 'Install Caveman for context compression.',
      actionType: 'compress',
      reason: triggered
        ? `Context window at ${ctx.contextWindowUsedPercent?.toFixed(0)}%. Risk of compaction or context loss.`
        : 'Context window usage is normal.',
    };
  },
};

const lowCacheHitRate: Policy = {
  id: 'low-cache-hit-rate',
  name: 'Low prompt cache hit rate',
  evaluate(ctx: PolicyContext): PolicyResult {
    const triggered = ctx.cacheReadRatio !== null && ctx.cacheReadRatio < 0.3;
    return {
      id: this.id,
      name: this.name,
      severity: triggered ? 'warn' : 'info',
      triggered,
      action: 'Reduce changes to tool definitions and system prompt to improve cache stability.',
      actionType: 'suggest',
      reason: triggered
        ? `Cache read ratio at ${((ctx.cacheReadRatio ?? 0) * 100).toFixed(0)}%. Most input tokens are not cached.`
        : 'Cache hit rate is healthy.',
    };
  },
};

const excessiveToolCalls: Policy = {
  id: 'excessive-tool-calls',
  name: 'Excessive tool calls',
  evaluate(ctx: PolicyContext): PolicyResult {
    const triggered = ctx.toolCallCount > 50;
    return {
      id: this.id,
      name: this.name,
      severity: triggered ? 'warn' : 'info',
      triggered,
      action: 'Consider compaction or splitting the task into smaller sessions.',
      actionType: 'split-session',
      reason: triggered
        ? `${ctx.toolCallCount} tool calls in this session. Each adds context tokens.`
        : 'Tool call count is normal.',
    };
  },
};

const repeatedFileReads: Policy = {
  id: 'repeated-file-reads',
  name: 'Repeated file reads',
  evaluate(ctx: PolicyContext): PolicyResult {
    const triggered = ctx.repeatedFileReads > 5;
    return {
      id: this.id,
      name: this.name,
      severity: triggered ? 'info' : 'info',
      triggered,
      action: 'Repeated reads waste tokens. Consider using deferred retrieval or caching.',
      actionType: 'reduce-reads',
      reason: triggered
        ? `${ctx.repeatedFileReads} files read more than once this session.`
        : 'No significant file read repetition.',
    };
  },
};

const cavemanOutputModuleDisabled: Policy = {
  id: 'caveman-output-disabled',
  name: 'Caveman output compression disabled',
  evaluate(ctx: PolicyContext): PolicyResult {
    const triggered = ctx.cavemanEnabled && !ctx.cavemanCompressingOutput;
    return {
      id: this.id,
      name: this.name,
      severity: triggered ? 'info' : 'info',
      triggered,
      action: 'Enable Caveman output module for tool output compression.',
      actionType: 'enable-module',
      reason: triggered
        ? 'Caveman is installed but output compression module is disabled.'
        : 'Output compression is active or Caveman not installed.',
    };
  },
};

const huntReconDump: Policy = {
  id: 'hunt-recon-dump',
  name: 'Large recon output in context',
  evaluate(ctx: PolicyContext): PolicyResult {
    const triggered = (ctx.huntContext?.reconBytesInContext ?? 0) > 5000;
    return {
      id: this.id,
      name: this.name,
      severity: triggered ? 'warn' : 'info',
      triggered,
      action: 'Recon output is large — summarize before ingesting into context.',
      actionType: 'suggest',
      reason: triggered
        ? `${ctx.huntContext!.reconBytesInContext} bytes of recon output in context. Summarize to save tokens.`
        : ctx.huntContext ? 'Recon output volume is normal.' : 'No hunt context available.',
    };
  },
};

const huntSkillBloat: Policy = {
  id: 'hunt-skill-bloat',
  name: 'Multiple hunt skills loaded',
  evaluate(ctx: PolicyContext): PolicyResult {
    const loaded = ctx.huntContext?.huntSkillsLoaded;
    const triggered = !!loaded && loaded.length > 3;
    return {
      id: this.id,
      name: this.name,
      severity: triggered ? 'info' : 'info',
      triggered,
      action: 'Multiple hunt skills loaded — load one class skill per hunter agent.',
      actionType: 'suggest',
      reason: triggered
        ? `${loaded!.length} hunt skills loaded: ${loaded!.join(', ')}. Each adds context tokens.`
        : ctx.huntContext ? 'Hunt skill count is normal.' : 'No hunt context available.',
    };
  },
};

const huntDedupSkipped: Policy = {
  id: 'hunt-dedup-skipped',
  name: 'Dedup gate not run before drafting',
  evaluate(ctx: PolicyContext): PolicyResult {
    const triggered = !!ctx.huntContext?.reportDraftStarted && !ctx.huntContext.dedupCheckRun;
    return {
      id: this.id,
      name: this.name,
      severity: triggered ? 'critical' : 'info',
      triggered,
      action: 'Dedup gate not run before drafting. Run dedup.py check first.',
      actionType: 'suggest',
      reason: triggered
        ? 'Report drafting started without a dedup check. This risks submitting a duplicate.'
        : ctx.huntContext ? 'Dedup discipline is intact.' : 'No hunt context available.',
    };
  },
};

const huntStaleBrain: Policy = {
  id: 'hunt-stale-brain',
  name: 'Hunt memory not accessed recently',
  evaluate(ctx: PolicyContext): PolicyResult {
    const ms = ctx.huntContext?.brainLastAccessMs;
    const triggered = ms !== undefined && ms !== null && ms > 30 * 60 * 1000;
    return {
      id: this.id,
      name: this.name,
      severity: triggered ? 'info' : 'info',
      triggered,
      action: 'Hunt memory not accessed in 30+ min — read brain.json to avoid repeating tested hypotheses.',
      actionType: 'suggest',
      reason: triggered
        ? `Brain last accessed ${Math.round(ms! / 60000)} min ago. May be retesting already-covered ground.`
        : ctx.huntContext ? 'Hunt memory access is recent.' : 'No hunt context available.',
    };
  },
};

export const ALL_POLICIES: Policy[] = [
  highContextPressure,
  lowCacheHitRate,
  excessiveToolCalls,
  repeatedFileReads,
  cavemanOutputModuleDisabled,
  huntReconDump,
  huntSkillBloat,
  huntDedupSkipped,
  huntStaleBrain,
];
