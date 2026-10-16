#!/usr/bin/env node

// ContextPilot observer hook — records Claude Code events to local telemetry DB.
// Writes NOTHING to stdout. Fails silently. Must exit < 5s.

import { z } from 'zod';
import {
  upsertSession,
  endSession,
  insertEvent,
  closeDb,
} from '@contextpilot/core';

const HookInputSchema = z.object({
  session_id: z.string(),
  hook_event_name: z.string(),
  cwd: z.string().optional(),
  tool_name: z.string().optional(),
  tool_response: z.string().optional(),
  duration_ms: z.number().optional(),
  model: z.string().optional(),
}).passthrough();

async function main(): Promise<void> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) return;

  let input: z.infer<typeof HookInputSchema>;
  try {
    input = HookInputSchema.parse(JSON.parse(raw));
  } catch {
    return;
  }

  const now = Date.now();
  const { session_id, hook_event_name } = input;

  try {
    switch (hook_event_name) {
      case 'SessionStart':
        upsertSession({
          id: session_id,
          started_at: now,
          model: input.model,
          cwd: input.cwd,
        });
        break;

      case 'SessionEnd':
        endSession(session_id, now);
        break;

      case 'PostToolUse':
      case 'PostToolUseFailure':
        insertEvent({
          session_id,
          event_type: hook_event_name,
          timestamp_ms: now,
          tool_name: input.tool_name,
          payload_bytes: input.tool_response?.length,
          duration_ms: input.duration_ms,
        });
        break;

      case 'PreCompact':
      case 'Stop':
        insertEvent({
          session_id,
          event_type: hook_event_name,
          timestamp_ms: now,
        });
        break;

      default:
        insertEvent({
          session_id,
          event_type: hook_event_name,
          timestamp_ms: now,
        });
    }
  } catch {
    // fail silently
  } finally {
    closeDb();
  }
}

main().catch(() => {});
