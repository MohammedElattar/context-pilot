import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@contextpilot/core', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@contextpilot/core')>();
  return {
    ...orig,
    detectEnvironment: vi.fn(async () => ({
      os: { type: 'Linux', release: '6.0', arch: 'x64' },
      shell: '/bin/zsh',
      node: { version: '20.0.0', path: '/usr/bin/node' },
      claudeCode: {
        installed: true,
        version: '1.0.0',
        settingsExists: true,
        settingsPath: '/home/test/.claude/settings.json',
        model: null,
        anthropicBaseUrl: null,
      },
    })),
    detectHooks: vi.fn(async () => ({
      hooks: [],
      totalByEvent: {},
      conflicts: [],
    })),
    detectPlugins: vi.fn(async () => ({
      plugins: [],
      mcpServers: [],
    })),
    detectProxy: vi.fn(async () => ({
      detected: false,
      running: false,
      port: null,
      pid: null,
      version: null,
      mode: null,
    })),
    readCavemanConfig: vi.fn(async () => ({
      installed: false,
      entitled: false,
      plan: null,
      expiresAt: null,
      modules: {},
      telemetryTokens: null,
    })),
    readCavemanIntegration: vi.fn(async () => ({
      packVersion: null,
      mcpInstalled: false,
    })),
    readCavemanHistory: vi.fn(async () => []),
  };
});

import { runDoctor } from './doctor.js';

describe('runDoctor', () => {
  let output: string[];

  beforeEach(() => {
    output = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      output.push(args.map(String).join(' '));
    });
  });

  it('outputs valid JSON in json mode', async () => {
    await runDoctor({ json: true });
    const json = JSON.parse(output.join(''));
    expect(json).toHaveProperty('environment');
    expect(json).toHaveProperty('hooks');
    expect(json).toHaveProperty('plugins');
    expect(json).toHaveProperty('proxy');
    expect(json).toHaveProperty('caveman');
  });

  it('outputs text in default mode without throwing', async () => {
    await runDoctor({});
    expect(output.length).toBeGreaterThan(0);
  });
});
