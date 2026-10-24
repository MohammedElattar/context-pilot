#!/usr/bin/env node

// ContextPilot re-read guard — a NON-BLOCKING PreToolUse hook.
// When the model is about to Read a file it already read this session and the
// file hasn't changed (same fingerprint), emits a brief advisory via
// additionalContext. NEVER sets permissionDecision.

import { z } from 'zod';
import { existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openReadOnly, paths } from '@contextpilot/core';

function fileFingerprint(path: string): string | null {
  try {
    const s = statSync(path);
    return createHash('sha256').update(`${path}:${s.mtimeMs}:${s.size}`).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

const InputSchema = z.object({
  session_id: z.string(),
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

  if (!existsSync(paths.contextPilot.db)) return;

  const advisories: string[] = [];

  // 1. File re-read guard (Read tool only).
  if (input.tool_name === 'Read') {
    try {
      const toolInput = typeof input.tool_input === 'string'
        ? JSON.parse(input.tool_input)
        : input.tool_input;
      const filePath: string | undefined = toolInput?.file_path;
      if (filePath) {
        const db = openReadOnly(paths.contextPilot.db);
        const prev = db.prepare(
          'SELECT fingerprint FROM file_reads WHERE session_id = ? AND file_path = ? AND fingerprint IS NOT NULL ORDER BY timestamp_ms DESC LIMIT 1'
        ).get(input.session_id, filePath) as { fingerprint: string } | undefined;
        db.close();

        if (prev) {
          const currentFp = fileFingerprint(filePath);
          if (currentFp && currentFp === prev.fingerprint) {
            advisories.push(`File "${filePath}" was already read this session and hasn't changed. Consider reusing the earlier content instead of re-reading.`);
          }
        }
      }
    } catch { /* fail silently */ }
  }

  // 2. Output-budget advisory (all tools).
  try {
    const db = openReadOnly(paths.contextPilot.db);
    const row = db.prepare(
      'SELECT COALESCE(SUM(output_tokens), 0) as total FROM token_snapshots WHERE session_id = ?'
    ).get(input.session_id) as { total: number };
    db.close();

    if (row.total > 50000) {
      advisories.push(`Session output high (${Math.round(row.total / 1000)}k tokens). Keep responses minimal.`);
    }
  } catch { /* fail silently */ }

  if (advisories.length === 0) return;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: advisories.join(' '),
    },
  }));
}

main().catch(() => {});
