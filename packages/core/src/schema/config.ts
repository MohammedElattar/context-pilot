import { z } from 'zod';

export const HookHandlerSchema = z.object({
  type: z.string(),
  command: z.string(),
  timeout: z.number().optional(),
}).passthrough();

export const HookGroupSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(HookHandlerSchema),
}).passthrough();

export const HooksSchema = z.record(
  z.string(),
  z.array(HookGroupSchema).optional(),
).optional();

export const ClaudeSettingsSchema = z.object({
  model: z.string().optional(),
  theme: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  hooks: HooksSchema,
  enabledPlugins: z.record(z.string(), z.boolean()).optional(),
  permissions: z.record(z.string(), z.array(z.string())).optional(),
}).passthrough();

export const ClaudeMcpServerSchema = z.object({
  type: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
}).passthrough();

export const ClaudeJsonSchema = z.object({
  mcpServers: z.record(z.string(), ClaudeMcpServerSchema).optional(),
}).passthrough();

export type HookHandler = z.infer<typeof HookHandlerSchema>;
export type HookGroup = z.infer<typeof HookGroupSchema>;
export type ClaudeSettings = z.infer<typeof ClaudeSettingsSchema>;
export type ClaudeJson = z.infer<typeof ClaudeJsonSchema>;
