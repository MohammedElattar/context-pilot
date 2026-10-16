import { z } from 'zod';

export const CavemanCloudSchema = z.object({
  firstRunAt: z.string().optional(),
  modules: z.record(z.string(), z.boolean()).optional(),
  baseURL: z.string().optional(),
  gatewayUrl: z.string().optional(),
  wrapEntitlement: z.object({
    plan: z.string(),
    entitled: z.boolean(),
    expires_at: z.string(),
    telemetry_level: z.string().optional(),
    devices_used: z.number().optional(),
    seats_used: z.number().optional(),
  }).passthrough().optional(),
  telemetryTokens: z.object({
    tokensIn: z.number(),
    tokensSaved: z.number(),
    at: z.string(),
  }).optional(),
  think: z.object({
    core: z.boolean().optional(),
    mode: z.string().optional(),
    toon: z.boolean().optional(),
    shrink: z.boolean().optional(),
  }).optional(),
}).passthrough();

export const CavemanRunSchema = z.object({
  schema: z.string().optional(),
  pid: z.number(),
  port: z.number(),
  listen: z.string(),
  mode: z.string(),
  version: z.string(),
  started_at: z.string(),
  recovery_via_mcp: z.boolean().optional(),
  provider_upstreams: z.record(z.string(), z.string()).optional(),
}).passthrough();

export const CavemanIntegrationSchema = z.object({
  schema_version: z.number(),
  agent: z.string(),
  pack_version: z.string().optional(),
  installed_at: z.string().optional(),
  detected_agent_version: z.string().optional(),
  operations: z.array(z.object({
    file: z.string(),
    kind: z.string(),
    owned: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()),
}).passthrough();

export const CavemanHistoryEntrySchema = z.object({
  ts: z.number(),
  session_id: z.string(),
  mode: z.string().nullable(),
  model: z.string().nullable(),
  output_tokens: z.number(),
  output_tokens_availability: z.string().optional(),
  turns: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  cache_read_input_tokens_availability: z.string().optional(),
  output_tokens_by_mode: z.record(z.string(), z.number()).optional(),
  unattributed_output_tokens: z.number().optional(),
}).passthrough();

export const CavemanModeLogEntrySchema = z.object({
  ts: z.number(),
  mode: z.string().nullable(),
  prev: z.string().nullable(),
  session_id: z.string(),
}).passthrough();

export type CavemanCloud = z.infer<typeof CavemanCloudSchema>;
export type CavemanRun = z.infer<typeof CavemanRunSchema>;
export type CavemanIntegration = z.infer<typeof CavemanIntegrationSchema>;
export type CavemanHistoryEntry = z.infer<typeof CavemanHistoryEntrySchema>;
export type CavemanModeLogEntry = z.infer<typeof CavemanModeLogEntrySchema>;
