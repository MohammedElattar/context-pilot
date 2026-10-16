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
