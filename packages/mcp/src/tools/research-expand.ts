import { expandEvidence } from '@contextpilot/core';

/**
 * contextpilot_expand handler. Recovers omitted or fuller evidence by stable id
 * from the local cache with no network request.
 */
export async function handleResearchExpand(args: {
  evidence_id?: string;
  mode?: 'section' | 'full';
  offset?: number;
  limit?: number;
}) {
  if (!args.evidence_id || typeof args.evidence_id !== 'string') {
    return { ok: false, error: 'Missing required "evidence_id" argument.', code: 'bad_args', fallback: 'Re-run contextpilot_fetch.' };
  }
  const mode = args.mode === 'full' ? 'full' : 'section';
  return expandEvidence({ evidence_id: args.evidence_id, mode, offset: args.offset, limit: args.limit });
}
