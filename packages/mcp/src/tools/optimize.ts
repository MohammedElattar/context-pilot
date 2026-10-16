import { existsSync } from 'node:fs';
import {
  openReadOnly,
  paths,
  detectProxy,
  readCavemanConfig,
  loadConfig,
  getRepeatedFileReadCount,
} from '@contextpilot/core';

export async function handleOptimize(args: { session_id?: string }) {
  const actions: string[] = [];

  const [proxy, cavemanConfig, config] = await Promise.all([
    detectProxy(),
    readCavemanConfig(),
    Promise.resolve(loadConfig()),
  ]);

  let toolCallCount = 0;
  let repeatedReads = 0;
  let sessionId: string | null = null;

  if (existsSync(paths.contextPilot.db)) {
    try {
      const db = openReadOnly(paths.contextPilot.db);
      const row = args.session_id
        ? db.prepare('SELECT id FROM sessions WHERE id = ?').get(args.session_id) as any
        : db.prepare('SELECT id FROM sessions ORDER BY started_at DESC LIMIT 1').get() as any;
      sessionId = row?.id ?? null;

      if (sessionId) {
        toolCallCount = (db.prepare(
          'SELECT COUNT(*) as cnt FROM events WHERE session_id = ? AND tool_name IS NOT NULL'
        ).get(sessionId) as any)?.cnt ?? 0;
        repeatedReads = getRepeatedFileReadCount(sessionId, 1, db);
      }
      db.close();
    } catch { /* ignore */ }
  }

  if (proxy.detected && cavemanConfig) {
    const modules = (cavemanConfig as any).modules;
    if (typeof modules === 'object' && modules?.output !== true) {
      actions.push('Enable Caveman output compression to reduce tool output tokens: run `caveman module enable output`');
    }
    if (typeof modules === 'object' && modules?.input !== true) {
      actions.push('Enable Caveman input compression: run `caveman module enable input`');
    }
    actions.push('Use caveman_compress MCP tool for large text payloads before they enter context.');
  } else if (!proxy.detected) {
    actions.push('Install Caveman (caveman.so) for proxy-based token compression and recovery.');
  }

  if (repeatedReads > 0) {
    actions.push(`${repeatedReads} file(s) read multiple times this session. Call contextpilot_session_files to identify them and avoid re-reads.`);
  }

  if (toolCallCount > 50) {
    actions.push(`${toolCallCount} tool calls this session. Consider using /compact or splitting into smaller tasks.`);
  }

  if (toolCallCount > 20) {
    actions.push('Prefer Edit over Read+Write for small file changes — sends only the diff, not the full file.');
  }

  return {
    session_id: sessionId,
    mode: config.mode,
    caveman_detected: proxy.detected,
    caveman_version: proxy.detected ? proxy.version : null,
    tool_call_count: toolCallCount,
    repeated_file_reads: repeatedReads,
    optimization_actions: actions,
    action_count: actions.length,
  };
}
