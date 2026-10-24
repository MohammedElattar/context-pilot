import { describe, it, expect } from 'vitest';
import { formatStatusLine } from './format.js';

describe('formatStatusLine', () => {
  it('shows model, effort, and both limits', () => {
    const out = formatStatusLine(JSON.stringify({
      model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
      effort: { level: 'high' },
      rate_limits: {
        five_hour: { used_percentage: 42.4 },
        seven_day: { used_percentage: 13.6 },
      },
    }));
    expect(out).toBe('Opus 5.5 │ effort: high │ 5h: 42% used │ weekly: 14% used');
  });

  it('renders placeholders when fields are missing', () => {
    expect(formatStatusLine('{}')).toBe('model ? │ effort: effort ? │ 5h: ? │ weekly: ?');
  });

  it('falls back to model id when display name is absent', () => {
    expect(formatStatusLine(JSON.stringify({ model: { id: 'claude-haiku-5-5' } })))
      .toContain('claude-haiku-5-5');
  });

  it('fails open on invalid JSON', () => {
    expect(formatStatusLine('not json')).toBe('ContextPilot');
  });
});
