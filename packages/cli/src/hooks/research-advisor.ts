#!/usr/bin/env node

// ContextPilot research advisor — a NON-BLOCKING PreToolUse hook.
// On a native research tool (WebSearch/WebFetch, or a network Bash command) it
// emits a one-line suggestion to prefer the research gateway, via
// hookSpecificOutput.additionalContext ONLY. It NEVER sets permissionDecision,
// so it can never block or override another hook (e.g. Caveman's Bash guard).
// Fails silent; always exits 0. Registered only by `contextpilot setup --research`.

import { z } from 'zod';
import { suggestionFor } from './research-advisor-logic.js';

const InputSchema = z.object({
  hook_event_name: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
}).passthrough();

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

  const suggestion = suggestionFor(input.tool_name, input.tool_input);
  if (!suggestion) return; // silent on anything else

  // additionalContext ONLY — no permissionDecision, so the call is never blocked.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: suggestion.slice(0, 295),
    },
  }));
}

main().catch(() => {});
