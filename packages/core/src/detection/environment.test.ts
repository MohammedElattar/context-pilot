import { describe, it, expect } from 'vitest';
import { detectEnvironment } from './environment.js';

describe('detectEnvironment', () => {
  it('returns OS info', async () => {
    const env = await detectEnvironment();
    expect(env.os.platform).toBeTruthy();
    expect(env.os.arch).toBeTruthy();
    expect(env.os.type).toBeTruthy();
  });

  it('returns Node info', async () => {
    const env = await detectEnvironment();
    expect(env.node.version).toMatch(/^v\d+/);
    expect(env.node.path).toBeTruthy();
  });

  it('detects shell from env', async () => {
    const env = await detectEnvironment();
    if (process.env.SHELL) {
      expect(env.shell).toBe(process.env.SHELL);
    }
  });

  it('detects Claude Code settings existence', async () => {
    const env = await detectEnvironment();
    expect(typeof env.claudeCode.settingsExists).toBe('boolean');
  });
});
