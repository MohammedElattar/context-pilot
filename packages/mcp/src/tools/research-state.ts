import { existsSync } from 'node:fs';
import { openReadOnly, paths, getResearchSummary } from '@contextpilot/core';

/**
 * contextpilot_research_state handler. Read-only session summary of gateway
 * usage: routed calls vs native WebFetch/WebSearch (adoption), cache hit-rate,
 * and estimated token savings. Fail-open: returns zeros when the DB is absent.
 */
export async function handleResearchState(args: { session_id?: string }) {
  if (!existsSync(paths.contextPilot.db)) {
    return { note: 'No telemetry DB yet — no research activity recorded.', routed_calls: 0 };
  }
  try {
    const db = openReadOnly(paths.contextPilot.db);
    try {
      return getResearchSummary(args.session_id, db);
    } finally {
      db.close();
    }
  } catch {
    return { note: 'Could not read research telemetry.', routed_calls: 0 };
  }
}
