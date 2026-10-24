#!/usr/bin/env node

// ContextPilot prompt advisor — injects brief optimization hints on UserPromptExpansion.
// Outputs plain text (< 300 chars) ONLY when a policy triggers. Fails silently.

import { existsSync } from 'node:fs';
import { z } from 'zod';
import {
  openReadOnly,
  paths,
  buildPolicyContext,
  getTriggeredPolicies,
  getActionsForMode,
  evaluatePolicies,
  getRepeatedFileReadCount,
  getCacheReadRatio,
  estimateContextWindowUsage,
  loadConfig,
} from '@contextpilot/core';

const InputSchema = z.object({
  session_id: z.string(),
  hook_event_name: z.string(),
}).passthrough();

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) return;

  let input: z.infer<typeof InputSchema>;
  try { input = InputSchema.parse(JSON.parse(raw)); } catch { return; }

  if (!existsSync(paths.contextPilot.db)) return;

  let toolCount = 0;
  let repeatedReads = 0;
  let cacheRatio: number | null = null;
  let contextPercent: number | null = null;

  try {
    const db = openReadOnly(paths.contextPilot.db);
    const session = db.prepare(
      'SELECT id FROM sessions WHERE id = ?'
    ).get(input.session_id) as any;

    if (!session) { db.close(); return; }

    toolCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM events WHERE session_id = ? AND tool_name IS NOT NULL'
    ).get(session.id) as any)?.cnt ?? 0;

    repeatedReads = getRepeatedFileReadCount(session.id, 1, db);
    cacheRatio = getCacheReadRatio(session.id, db);
    contextPercent = estimateContextWindowUsage(session.id, db);
    db.close();
  } catch { return; }

  const config = loadConfig();
  const ctx = buildPolicyContext({
    toolCallCount: toolCount,
    repeatedFileReads: repeatedReads,
    cacheReadRatio: cacheRatio ?? undefined,
    contextWindowUsedPercent: contextPercent ?? undefined,
    currentMode: config.mode,
  });

  const CONCISE = 'Be concise. Short answers for simple questions. No filler, no preamble.';

  const results = evaluatePolicies(ctx);
  const triggered = results.filter(r => r.triggered);
  if (triggered.length === 0) {
    process.stdout.write(CONCISE);
    return;
  }

  const actions = getActionsForMode(config.mode, results);
  const parts: string[] = [CONCISE, `ContextPilot [${config.mode}]: ${toolCount} tool calls`];
  if (repeatedReads > 0) parts.push(`${repeatedReads} files re-read`);

  if (actions.length > 0) {
    parts.push(actions.map(a => a.action).join(' | '));
  } else {
    parts.push(triggered[0].action);
  }

  process.stdout.write(parts.join('. ').slice(0, 395));
}

main().catch(() => {});
