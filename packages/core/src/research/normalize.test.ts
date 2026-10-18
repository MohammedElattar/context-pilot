import { describe, it, expect } from 'vitest';
import { normalizeUrl, hashString } from './normalize.js';

describe('normalizeUrl', () => {
  it('lowercases host, drops fragment and default port', () => {
    const { normalized } = normalizeUrl('HTTP://Example.COM:80/Path#frag');
    expect(normalized).toBe('http://example.com/Path');
  });

  it('strips tracking params but keeps content params, sorted', () => {
    const { normalized } = normalizeUrl('https://x.test/p?b=2&utm_source=n&a=1&fbclid=z');
    expect(normalized).toBe('https://x.test/p?a=1&b=2');
  });

  it('trims a trailing slash on non-root paths only', () => {
    expect(normalizeUrl('https://x.test/a/').normalized).toBe('https://x.test/a');
    expect(normalizeUrl('https://x.test/').normalized).toBe('https://x.test/');
  });

  it('produces a stable 32-char hash; identical URLs collide, different do not', () => {
    const a = normalizeUrl('https://x.test/a?one=1&two=2');
    const b = normalizeUrl('https://x.test/a?two=2&one=1');
    expect(a.urlHash).toHaveLength(32);
    expect(a.urlHash).toBe(b.urlHash);
    expect(a.urlHash).not.toBe(normalizeUrl('https://x.test/b').urlHash);
  });

  it('hashString is deterministic', () => {
    expect(hashString('hello')).toBe(hashString('hello'));
    expect(hashString('hello')).not.toBe(hashString('world'));
  });
});
