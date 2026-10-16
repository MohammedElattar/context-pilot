#!/usr/bin/env node

// ContextPilot compact advisor — injects budget status after context compaction.
// Always outputs a brief message. Fails silently.

import { existsSync } from 'node:fs';
import { z } from 'zod';
import {
  openReadOnly,
  paths,
  getRepeatedFileReadCount,
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

  try {
    const db = openReadOnly(paths.contextPilot.db);
    const session = db.prepare(
      'SELECT id FROM sessions WHERE id = ?'
    ).get(input.session_id) as any;

    if (!session) { db.close(); return; }

    const toolCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM events WHERE session_id = ? AND tool_name IS NOT NULL'
    ).get(session.id) as any)?.cnt ?? 0;

    const repeatedReads = getRepeatedFileReadCount(session.id, 1, db);
    db.close();

    const parts = [`ContextPilot: Context compacted. ${toolCount} tool calls this session`];
    if (repeatedReads > 0) {
      parts.push(`${repeatedReads} files read 2+ times — call contextpilot_session_files to see which and avoid re-reads`);
    }

    process.stdout.write(parts.join('. ').slice(0, 295));
  } catch { /* fail silently */ }
}

main().catch(() => {});
