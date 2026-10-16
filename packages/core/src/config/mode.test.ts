import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, setMode, saveConfig } from './mode.js';
import { unlinkSync } from 'node:fs';
import { paths } from './paths.js';

describe('mode config', () => {
  afterEach(() => {
    try {
      unlinkSync(paths.contextPilot.config);
    } catch {
      // file may not exist
    }
  });

  it('defaults to observe when no config exists', () => {
    try { unlinkSync(paths.contextPilot.config); } catch {}
    const config = loadConfig();
    expect(config.mode).toBe('observe');
  });

  it('persists mode changes', () => {
    setMode('canary');
    const config = loadConfig();
    expect(config.mode).toBe('canary');
    expect(config.updatedAt).toBeTruthy();
  });

  it('round-trips through save/load', () => {
    saveConfig({ mode: 'auto', updatedAt: '2026-01-01T00:00:00Z' });
    const loaded = loadConfig();
    expect(loaded.mode).toBe('auto');
  });
});
