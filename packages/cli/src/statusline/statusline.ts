#!/usr/bin/env node

// ContextPilot status line — prints model, effort, and 5h/weekly limit usage.
// Claude Code pipes status JSON on stdin and shows stdout as the status bar.
// Fails open: any error prints a fallback label instead of breaking the bar.

import { formatStatusLine } from './format.js';

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.stdout.write(formatStatusLine(Buffer.concat(chunks).toString('utf-8')));
}

main().catch(() => process.stdout.write('ContextPilot'));
