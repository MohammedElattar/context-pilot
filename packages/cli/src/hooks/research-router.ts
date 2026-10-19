#!/usr/bin/env node

// ContextPilot strict research router — an OPT-IN PreToolUse hook (registered
// only by `contextpilot setup --research --strict`). It DENIES native
// WebFetch/WebSearch with a reason telling Claude to use the gateway tools.
// Honors the CONTEXTPILOT_ALLOW_NATIVE=1 escape so native stays recoverable when
// the gateway cannot fetch. Fails open: on any error it emits nothing (the call
// proceeds), so a router bug never hard-blocks research.

import { z } from 'zod';
import { routeDecision } from './research-router-logic.js';

const InputSchema = z.object({ tool_name: z.string().optional() }).passthrough();

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) return;

  let input: z.infer<typeof InputSchema>;
  try {
    input = InputSchema.parse(JSON.parse(raw));
  } catch {
    return;
  }

  const allowNative = process.env.CONTEXTPILOT_ALLOW_NATIVE === '1';
  const d = routeDecision(input.tool_name, allowNative);
  if (!d) return; // silent → call proceeds

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: d.decision,
      permissionDecisionReason: d.reason,
    },
  }));
}

main().catch(() => {});
