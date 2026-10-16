import { existsSync } from 'node:fs';
import {
  openReadOnly,
  paths,
  getSessionFileReads,
} from '@contextpilot/core';

export async function handleSessionFiles(args: { session_id?: string; min_reads?: number }) {
  if (!existsSync(paths.contextPilot.db)) {
    return { files: [], message: 'No telemetry DB found. Observer hooks may not be registered.' };
  }

  try {
    const db = openReadOnly(paths.contextPilot.db);

    const sessionId = args.session_id ?? (() => {
      const row = db.prepare('SELECT id FROM sessions ORDER BY started_at DESC LIMIT 1').get() as any;
      return row?.id;
    })();

    if (!sessionId) {
      db.close();
      return { files: [], message: 'No sessions found.' };
    }

    let files = getSessionFileReads(sessionId, db);
    db.close();

    if (args.min_reads && args.min_reads > 1) {
      files = files.filter(f => f.read_count >= args.min_reads!);
    }

    return {
      session_id: sessionId,
      total_files: files.length,
      total_reads: files.reduce((s, f) => s + f.read_count, 0),
      files: files.map(f => ({
        file_path: f.file_path,
        read_count: f.read_count,
        total_bytes: f.total_payload_bytes,
        first_read: new Date(f.first_read_ms).toISOString(),
        last_read: new Date(f.last_read_ms).toISOString(),
      })),
    };
  } catch (err) {
    return { files: [], message: err instanceof Error ? err.message : 'Error reading telemetry.' };
  }
}
