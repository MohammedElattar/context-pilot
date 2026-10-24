export { detectEnvironment, type EnvironmentInfo } from './detection/environment.js';
export { detectHooks, type HookInfo, type HookConflict, type HookReport } from './detection/hooks.js';
export { detectPlugins, type PluginInfo, type McpServerInfo, type PluginsReport } from './detection/plugins.js';
export { detectProxy, type ProxyInfo } from './detection/proxies.js';

export {
  readCavemanConfig,
  readCavemanIntegration,
  readCavemanHistory,
  readCavemanModeLog,
  type CavemanConfig,
  type CavemanIntegrationInfo,
} from './adapters/caveman/index.js';

export { paths } from './config/paths.js';
export {
  getCavemanTokenStats,
  getCavemanSessionStats,
  getCavemanModeHistory,
  getLatestCavemanRequest,
  getCavemanLearnSinks,
  getInputOptimizationStats,
  type CavemanTokenStats,
  type CavemanSessionStats,
  type CavemanModeHistoryEntry,
  type CavemanLatestRequest,
  type CavemanLearnSink,
  type InputOptimizationStats,
  getInputOptimizationTimeline,
  getCompressionStats,
  getCacheIntelligence,
  type InputOptimizationTimelineEntry,
  type CompressionStats,
  type CacheIntelligence,
  getCavemanPricing,
  type CavemanModelPricing,
} from './adapters/caveman/stats-reader.js';
export { detectAllTools, type DetectedTool } from './adapters/registry.js';
export type { OptimizerAdapter, Capability, AdapterStatus, HealthResult, ConflictDeclaration } from './adapters/types.js';
export {
  detectAgents,
  AGENT_ADAPTERS,
  ClaudeCodeAgentAdapter,
  type AgentAdapter,
  type AgentCapability,
  type AgentHealth,
  type DetectedAgent,
} from './adapters/agent.js';
export { detectConflicts, type Conflict, type ConflictReport, type ConflictSeverity } from './detection/conflicts.js';
export { loadConfig, saveConfig, setMode, type OperatingMode, type ContextPilotConfig } from './config/mode.js';
export { runBenchmark, BUILTIN_TASKS } from './benchmark/engine.js';
export { storeBenchmarkReport, getRecentBenchmarks, type BenchmarkRunRecord } from './benchmark/store.js';
export type {
  BenchmarkTask, BenchmarkConfig, BenchmarkRun, BenchmarkResult,
  BenchmarkReport, BenchmarkComparison, BenchmarkSummary,
} from './benchmark/types.js';

export { evaluatePolicies, evaluateAllPolicies, getTriggeredPolicies, buildPolicyContext, getActionsForMode } from './policy/engine.js';
export type { ModeAction } from './policy/engine.js';
export type { Policy, PolicyContext, PolicyResult, PolicySeverity, PolicyActionType, HuntContext } from './policy/types.js';
export { ALL_POLICIES } from './policy/policies.js';
export {
  compileDeclarativePolicy,
  loadDeclarativePolicies,
  validateDeclarativePolicies,
  DeclarativePolicySchema,
  DeclarativePolicyFileSchema,
  type DeclarativePolicy,
} from './policy/declarative.js';

export {
  getSessionCost,
  estimateCost,
  getModelPricing,
  getModelPricingWithCaveman,
  PRICING,
  type SessionCost,
  type BilledCost,
  type CostEstimate,
  type TokenCounts,
  type ModelPricing,
  type PricingTable,
} from './cost/index.js';

export {
  analyzeFileReads,
  type FileReadReport,
  type FileReadInsight,
  type Recommendation,
} from './intelligence/file-reads.js';
export {
  computeContextHealth,
  type ContextHealth,
  type HealthFactor,
  type FactorStatus,
} from './intelligence/health.js';

export {
  profileMcpTools,
  profileMcpServers,
  findUnusedMcpTools,
  parseMcpToolName,
  type McpToolProfile,
  type McpServerProfile,
} from './mcp-profile/profile.js';

export {
  normalizeUrl,
  hashString,
  safeFetch,
  isPrivateIp,
  FetchError,
  extract,
  extractPdf,
  rankSections,
  enforceBudget,
  estimateTokens,
  redactSecrets,
  evidenceId,
  fetchResearch,
  expandEvidence,
  recordResearch,
  resolveLatestSession,
  getResearchSummary,
  parseGitHubRef,
  fetchGitHubMarkdown,
  realGhExec,
  researchQuery,
  runResearchBenchmark,
  searchWeb,
  type NormalizedUrl,
  type SafeFetchOptions,
  type FetchResult,
  type Section,
  type ExtractResult,
  type RankedSection,
  type BudgetResult,
  type ResearchCacheRow,
  type EvidenceRow,
  type FetchResearchArgs,
  type ResearchResult,
  type EvidenceOut,
  type ExpandArgs,
  type ExpandResult,
  type ResearchLedgerEntry,
  type ResearchSummary,
  type GitHubRef,
  type GhExec,
  type ResearchQueryArgs,
  type ResearchQueryResult,
  type ResearchSource,
  type ResearchBenchTask,
  type ResearchBenchOptions,
  type ResearchBenchReport,
  type ResearchBenchTaskResult,
  type ArmResult,
  type SearchResult,
  type SearchResponse,
  type SearchOpts,
} from './research/index.js';

export { getDb, closeDb, openReadOnly } from './db/connection.js';
export {
  upsertSession,
  endSession,
  insertEvent,
  insertTokenSnapshot,
  type SessionRecord,
  type EventRecord,
  type TokenSnapshot,
  type UsageKind,
  insertFileRead,
  type FileReadRecord,
  insertFileWrite,
  type FileWriteRecord,
  resetTelemetry,
} from './db/telemetry-store.js';
export {
  getRecentSessions,
  getTokenAggregate,
  getToolUsageStats,
  type SessionSummary,
  type TokenAggregate,
  type ToolUsageStat,
  getSessionFileReads,
  getRepeatedFileReadCount,
  type FileReadStat,
  getSessionFileWrites,
  type FileWriteStat,
  getCacheReadRatio,
  estimateContextWindowUsage,
} from './db/telemetry-query.js';
