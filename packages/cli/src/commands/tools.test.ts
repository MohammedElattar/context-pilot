import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@contextpilot/core', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@contextpilot/core')>();
  return {
    ...orig,
    detectAllTools: vi.fn(async () => [
      {
        id: 'caveman',
        name: 'Caveman',
        status: 'installed',
        version: '4.0.1',
        healthy: true,
        healthMessage: null,
        capabilities: ['compression', 'recovery'],
        conflicts: [],
      },
    ]),
  };
});

import { runTools } from './tools.js';

describe('runTools', () => {
  let output: string[];

  beforeEach(() => {
    output = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      output.push(args.map(String).join(' '));
    });
  });

  it('outputs valid JSON array in json mode', async () => {
    await runTools({ json: true });
    const json = JSON.parse(output.join(''));
    expect(Array.isArray(json)).toBe(true);
    expect(json[0].id).toBe('caveman');
  });

  it('outputs text in default mode without throwing', async () => {
    await runTools({});
    expect(output.length).toBeGreaterThan(0);
    expect(output.some(line => line.includes('Caveman'))).toBe(true);
  });
});
