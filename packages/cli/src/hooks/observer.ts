#!/usr/bin/env node

// ContextPilot observer hook — records Claude Code events to local telemetry DB.
// Writes NOTHING to stdout. Fails silently. Must exit < 5s.

import { z } from 'zod';
import {
  upsertSession,
  endSession,
  insertEvent,
  insertFileRead,
  insertFileWrite,
  closeDb,
} from '@contextpilot/core';

const HookInputSchema = z.object({
  session_id: z.string(),
  hook_event_name: z.string(),
  cwd: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
  // Claude Code sends tool_response as a string OR an object depending on the
  // tool, so accept anything — a strict z.string() rejected object responses
  // (Read, Edit, Bash, …) and made the whole hook bail before recording.
  tool_response: z.unknown().optional(),
  duration_ms: z.number().optional(),
  model: z.string().optional(),
}).passthrough();

/** Byte length of a tool response, whether it arrives as a string or an object. */
function responseBytes(response: unknown): number | undefined {
  if (response == null) return undefined;
  return typeof response === 'string' ? response.length : JSON.stringify(response).length;
}

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
          payload_bytes: responseBytes(input.tool_response),
          duration_ms: input.duration_ms,
        });
        if (input.tool_input) {
          try {
            const toolInput = typeof input.tool_input === 'string'
              ? JSON.parse(input.tool_input)
              : input.tool_input;
            if (input.tool_name === 'Read' && toolInput?.file_path) {
              insertFileRead({
                session_id,
                file_path: toolInput.file_path,
                timestamp_ms: now,
                payload_bytes: responseBytes(input.tool_response),
              });
            }
            if ((input.tool_name === 'Write' || input.tool_name === 'Edit') && toolInput?.file_path) {
              insertFileWrite({
                session_id,
                file_path: toolInput.file_path,
                timestamp_ms: now,
                tool_name: input.tool_name,
              });
            }
          } catch { /* fail silently */ }
        }
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
