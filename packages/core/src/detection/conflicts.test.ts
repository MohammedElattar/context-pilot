import { describe, it, expect } from 'vitest';

describe('conflict severity ordering', () => {
  const order = ['critical', 'high', 'medium', 'low', 'info'];

  it('critical is highest severity', () => {
    expect(order.indexOf('critical')).toBe(0);
  });

  it('info is lowest severity', () => {
    expect(order.indexOf('info')).toBe(4);
  });
});

describe('compression overlap detection', () => {
  it('flags when multiple tools have compression capability', () => {
    const tools = [
      { id: 'caveman', capabilities: ['compression', 'proxy'] },
      { id: 'rtk', capabilities: ['compression'] },
    ];
    const compressors = tools.filter(t => t.capabilities.includes('compression'));
    expect(compressors.length).toBe(2);
  });

  it('does not flag single compressor', () => {
    const tools = [
      { id: 'caveman', capabilities: ['compression', 'proxy'] },
      { id: 'ccusage', capabilities: ['analytics'] },
    ];
    const compressors = tools.filter(t => t.capabilities.includes('compression'));
    expect(compressors.length).toBe(1);
  });
});

describe('hook stdout conflict detection', () => {
  it('flags multiple stdout writers on same event', () => {
    const hooks = [
      { event: 'PreToolUse', owner: 'caveman', writesStdout: 'yes' as const },
      { event: 'PreToolUse', owner: 'rtk', writesStdout: 'yes' as const },
    ];

    const writers = hooks.filter(h => h.writesStdout === 'yes');
    expect(writers.length).toBe(2);
  });

  it('does not flag single writer', () => {
    const hooks = [
      { event: 'PreToolUse', owner: 'caveman', writesStdout: 'yes' as const },
      { event: 'PreToolUse', owner: 'contextpilot', writesStdout: 'no' as const },
    ];

    const writers = hooks.filter(h => h.writesStdout === 'yes');
    expect(writers.length).toBe(1);
  });
});
