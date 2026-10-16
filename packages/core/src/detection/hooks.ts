import { loadClaudeSettings } from './environment.js';
import type { HookHandler } from '../schema/config.js';

export interface HookInfo {
  event: string;
  matcher: string;
  command: string;
  timeout?: number;
  owner: 'caveman' | 'contextpilot' | 'unknown';
  writesStdout: 'yes' | 'no' | 'unknown';
}

export interface HookConflict {
  event: string;
  hooks: HookInfo[];
  reason: string;
}

export interface HookReport {
  hooks: HookInfo[];
  conflicts: HookConflict[];
  totalByEvent: Record<string, number>;
}

function identifyOwner(command: string): HookInfo['owner'] {
  if (command.includes('caveman-proxy') || command.includes('caveman')) {
    return 'caveman';
  }
  if (command.includes('context-pilot') || command.includes('contextpilot')) {
    return 'contextpilot';
  }
  return 'unknown';
}

function couldWriteStdout(owner: HookInfo['owner']): HookInfo['writesStdout'] {
  if (owner === 'caveman') return 'yes';
  if (owner === 'contextpilot') return 'no';
  return 'unknown';
}

export async function detectHooks(): Promise<HookReport> {
  const settings = await loadClaudeSettings();
  const hooks: HookInfo[] = [];
  const totalByEvent: Record<string, number> = {};

  if (!settings?.hooks) {
    return { hooks, conflicts: [], totalByEvent };
  }

  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!groups) continue;
    let eventCount = 0;

    for (const group of groups) {
      const matcher = group.matcher ?? '';
      for (const handler of group.hooks) {
        const owner = identifyOwner(handler.command);
        hooks.push({
          event,
          matcher,
          command: handler.command,
          timeout: handler.timeout,
          owner,
          writesStdout: couldWriteStdout(owner),
        });
        eventCount++;
      }
    }

    totalByEvent[event] = eventCount;
  }

  const conflicts = detectConflicts(hooks);
  return { hooks, conflicts, totalByEvent };
}

function detectConflicts(hooks: HookInfo[]): HookConflict[] {
  const conflicts: HookConflict[] = [];
  const byEvent = new Map<string, HookInfo[]>();

  for (const hook of hooks) {
    const existing = byEvent.get(hook.event) ?? [];
    existing.push(hook);
    byEvent.set(hook.event, existing);
  }

  for (const [event, eventHooks] of byEvent) {
    const stdoutWriters = eventHooks.filter(h => h.writesStdout === 'yes' || h.writesStdout === 'unknown');
    if (stdoutWriters.length > 1) {
      conflicts.push({
        event,
        hooks: stdoutWriters,
        reason: `Multiple hooks may write stdout on ${event}. Hooks run in parallel — last result merged wins.`,
      });
    }
  }

  return conflicts;
}
