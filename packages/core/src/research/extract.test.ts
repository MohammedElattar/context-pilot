import { describe, it, expect } from 'vitest';
import { extract, extractPdf } from './extract.js';

describe('extract (HTML/text)', () => {
  it('keeps a <pre> code block verbatim', () => {
    const r = extract({ body: '<article><h2>Fix</h2><pre>const x = 1;\n  if (x) throw new Error("boom")</pre></article>', contentType: 'text/html' });
    const joined = r.sections.map(s => s.text).join('\n');
    expect(joined).toContain('throw new Error("boom")');
  });

  it('does not throw on malformed HTML', () => {
    expect(() => extract({ body: '<div><p>open <b>unclosed', contentType: 'text/html' })).not.toThrow();
  });
});

describe('extractPdf', () => {
  it('fails open (no throw) on non-PDF / corrupt bytes', async () => {
    const r = await extractPdf(new Uint8Array(Buffer.from('not a pdf at all')));
    expect(r.sections.length).toBeGreaterThanOrEqual(1);
    expect(r.sections[0].text).toMatch(/could not parse|no extractable/i);
  });
});
