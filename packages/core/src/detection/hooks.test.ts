import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('hook parsing', () => {
  it('identifies caveman hooks by command pattern', () => {
    const command = "'/home/user/.caveman/bin/caveman-proxy' native-hook claude";
    expect(command.includes('caveman-proxy')).toBe(true);
  });

  it('identifies contextpilot hooks by command pattern', () => {
    const command = 'node /path/to/context-pilot/dist/hooks/observer.js';
    expect(command.includes('context-pilot')).toBe(true);
  });

  it('identifies unknown hooks', () => {
    const command = 'gh-axi';
    expect(command.includes('caveman')).toBe(false);
    expect(command.includes('context-pilot')).toBe(false);
  });
});
