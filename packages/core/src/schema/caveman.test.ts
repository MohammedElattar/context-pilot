import { describe, it, expect } from 'vitest';
import {
  CavemanCloudSchema,
  CavemanRunSchema,
  CavemanHistoryEntrySchema,
  CavemanModeLogEntrySchema,
} from './caveman.js';

describe('CavemanCloudSchema', () => {
  it('parses real cloud.json data', () => {
    const data = {
      firstRunAt: '2026-10-15T13:12:53.779Z',
      modules: { output: false, routing: true },
      wrapEntitlement: {
        plan: 'free',
        entitled: true,
        expires_at: '2026-10-18T12:56:16Z',
      },
      telemetryTokens: {
        tokensIn: 112457146,
        tokensSaved: 65170,
        at: '2026-10-16T19:51:49.996Z',
      },
    };

    const result = CavemanCloudSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts extra fields via passthrough', () => {
    const data = {
      unknownField: true,
    };
    const result = CavemanCloudSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('CavemanRunSchema', () => {
  it('parses real run.json data', () => {
    const data = {
      pid: 20360,
      port: 8787,
      listen: '127.0.0.1:8787',
      mode: 'record',
      version: 'bin-v4.0.1',
      started_at: '2026-10-16T18:03:43.896199276Z',
      provider_upstreams: { anthropic: 'https://api.anthropic.com' },
    };

    const result = CavemanRunSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pid).toBe(20360);
      expect(result.data.mode).toBe('record');
    }
  });
});

describe('CavemanHistoryEntrySchema', () => {
  it('parses real history JSONL entry', () => {
    const data = {
      ts: 1792071197155,
      session_id: '8a271751-fca7-4704-8d79-ffdd052cd9d0',
      mode: 'ultracave',
      model: 'claude-sonnet-4-6',
      output_tokens: 22,
      turns: 2,
      cache_read_input_tokens: 80845,
      output_tokens_by_mode: { ultracave: 22 },
    };

    const result = CavemanHistoryEntrySchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.output_tokens).toBe(22);
    }
  });

  it('handles nullable mode', () => {
    const data = {
      ts: 1,
      session_id: 'test',
      mode: null,
      model: null,
      output_tokens: 0,
    };

    const result = CavemanHistoryEntrySchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('CavemanModeLogEntrySchema', () => {
  it('parses mode transition', () => {
    const data = {
      ts: 1792071175224,
      mode: 'caveman',
      prev: null,
      session_id: '8a271751-fca7-4704-8d79-ffdd052cd9d0',
    };

    const result = CavemanModeLogEntrySchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});
