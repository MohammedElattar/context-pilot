import { readFile } from 'node:fs/promises';
import { paths } from '../../config/paths.js';
import {
  CavemanHistoryEntrySchema,
  CavemanModeLogEntrySchema,
  type CavemanHistoryEntry,
  type CavemanModeLogEntry,
} from '../../schema/caveman.js';

export async function readCavemanHistory(): Promise<CavemanHistoryEntry[]> {
  return parseJsonl(paths.claude.cavemanHistory, CavemanHistoryEntrySchema);
}

export async function readCavemanModeLog(): Promise<CavemanModeLogEntry[]> {
  return parseJsonl(paths.claude.cavemanModeLog, CavemanModeLogEntrySchema);
}

async function parseJsonl<T>(
  filePath: string,
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T } },
): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const results: T[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const result = schema.safeParse(parsed);
        if (result.success && result.data) {
          results.push(result.data);
        }
      } catch {
        // skip malformed lines
      }
    }

    return results;
  } catch {
    return [];
  }
}
