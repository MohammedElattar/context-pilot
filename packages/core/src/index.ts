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
export { detectAllTools, type DetectedTool } from './adapters/registry.js';
export type { OptimizerAdapter, Capability, AdapterStatus, HealthResult, ConflictDeclaration } from './adapters/types.js';
export { detectConflicts, type Conflict, type ConflictReport, type ConflictSeverity } from './detection/conflicts.js';
export { loadConfig, saveConfig, setMode, type OperatingMode, type ContextPilotConfig } from './config/mode.js';
export { runBenchmark, BUILTIN_TASKS } from './benchmark/engine.js';
export type {
  BenchmarkTask, BenchmarkConfig, BenchmarkRun, BenchmarkResult,
  BenchmarkReport, BenchmarkComparison, BenchmarkSummary,
} from './benchmark/types.js';

export { evaluatePolicies, getTriggeredPolicies, buildPolicyContext } from './policy/engine.js';
export type { Policy, PolicyContext, PolicyResult, PolicySeverity } from './policy/types.js';
export { ALL_POLICIES } from './policy/policies.js';

export { getDb, closeDb, openReadOnly } from './db/connection.js';
export {
  upsertSession,
  endSession,
  insertEvent,
  insertTokenSnapshot,
  type SessionRecord,
  type EventRecord,
  type TokenSnapshot,
} from './db/telemetry-store.js';
export {
  getRecentSessions,
  getTokenAggregate,
  getToolUsageStats,
  type SessionSummary,
  type TokenAggregate,
  type ToolUsageStat,
} from './db/telemetry-query.js';
