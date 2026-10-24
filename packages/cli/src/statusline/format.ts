import { z } from 'zod';

// Subset of the Claude Code status line JSON. Every field is optional: the
// status line must still render when Claude Code omits a field.
const StatusLineInputSchema = z.object({
  model: z.object({
    id: z.string().optional(),
    display_name: z.string().optional(),
  }).passthrough().optional(),
  effort: z.object({
    level: z.string().optional(),
  }).passthrough().optional(),
  rate_limits: z.object({
    five_hour: z.object({ used_percentage: z.number().optional() }).passthrough().optional(),
    seven_day: z.object({ used_percentage: z.number().optional() }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

export function formatStatusLine(raw: string): string {
  let parsed: z.infer<typeof StatusLineInputSchema>;
  try {
    parsed = StatusLineInputSchema.parse(JSON.parse(raw));
  } catch {
    return 'ContextPilot';
  }

  const model = parsed.model?.display_name ?? parsed.model?.id ?? 'model ?';
  const effort = parsed.effort?.level ?? 'effort ?';
  const fiveHour = formatLimit(parsed.rate_limits?.five_hour?.used_percentage);
  const sevenDay = formatLimit(parsed.rate_limits?.seven_day?.used_percentage);

  return [`${model}`, `effort: ${effort}`, `5h: ${fiveHour}`, `weekly: ${sevenDay}`].join(' │ ');
}

function formatLimit(used: number | undefined): string {
  if (used === undefined || !Number.isFinite(used)) return '?';
  return `${Math.round(used)}% used`;
}
