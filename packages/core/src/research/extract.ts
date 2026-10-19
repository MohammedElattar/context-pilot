import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

export interface Section {
  heading: string;
  text: string;
  /** True when the section contains a <pre>/code block kept verbatim. */
  hasCode: boolean;
}

export interface ExtractResult {
  title: string;
  sections: Section[];
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NAV', 'FOOTER', 'HEADER', 'FORM', 'NOSCRIPT', 'SVG', 'ASIDE']);
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function looksLikeHtml(body: string): boolean {
  return /<\s*(html|body|div|p|h[1-6]|article|main|table|pre)[\s>]/i.test(body);
}

/** Collapse runs of whitespace — used for prose, never for code. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Reduce a fetched body to titled sections. HTML runs through Readability for
 * main-content isolation, then is split at headings. <pre> blocks are kept
 * byte-for-byte (collapse would corrupt stack traces, errors, and code). Never
 * throws: malformed HTML falls back to a crude strip, non-HTML passes through.
 */
export function extract(input: { body: string; contentType?: string; url?: string }): ExtractResult {
  const { body } = input;
  const ct = (input.contentType ?? '').toLowerCase();

  if (ct.includes('json') || (!ct.includes('html') && !looksLikeHtml(body))) {
    return extractNonHtml(body, ct);
  }

  try {
    return extractHtml(body, input.url);
  } catch {
    return { title: '', sections: fallbackStrip(body) };
  }
}

function extractHtml(body: string, url?: string): ExtractResult {
  // Readability consumes its document, so parse twice: once for main-content
  // isolation, once (fresh) as the fallback source if Readability bails.
  let title = '';
  let contentHtml = '';
  try {
    const { document } = parseHTML(body);
    const article = new Readability(document as any, { charThreshold: 200 }).parse();
    if (article) {
      title = collapse(article.title ?? '');
      contentHtml = article.content ?? '';
    }
  } catch {
    /* fall through to full-document parse */
  }

  const source = contentHtml || body;
  const { document } = parseHTML(source);
  if (!title) title = collapse(document.querySelector('title')?.textContent ?? '');

  const sections = walkSections(document);
  if (sections.length === 0) {
    return { title, sections: fallbackStrip(body) };
  }
  return { title, sections };
}

function walkSections(document: any): Section[] {
  const nodes = document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,li,blockquote,td,th');
  const sections: Section[] = [];
  let current: Section = { heading: '', text: '', hasCode: false };
  const parts: string[] = [];

  const flush = () => {
    const text = parts.join('\n').trim();
    if (text || current.heading) {
      sections.push({ heading: current.heading, text, hasCode: current.hasCode });
    }
    parts.length = 0;
    current = { heading: '', text: '', hasCode: false };
  };

  for (const el of nodes) {
    const tag = String(el.tagName ?? '').toUpperCase();
    if (hasSkippedAncestor(el)) continue;
    // Elements nested inside a <pre> are emitted as part of the pre itself.
    if (tag !== 'PRE' && hasAncestor(el, 'PRE')) continue;

    if (HEADING_TAGS.has(tag)) {
      flush();
      current.heading = collapse(el.textContent ?? '');
      continue;
    }
    if (tag === 'PRE') {
      const raw = String(el.textContent ?? '').replace(/\s+$/, '');
      if (raw) {
        parts.push(raw); // verbatim: no collapse
        current.hasCode = true;
      }
      continue;
    }
    const t = collapse(el.textContent ?? '');
    if (t) parts.push(t);
  }
  flush();
  return sections.filter(s => s.text.length > 0);
}

function hasSkippedAncestor(el: any): boolean {
  let p = el;
  while (p) {
    if (SKIP_TAGS.has(String(p.tagName ?? '').toUpperCase())) return true;
    p = p.parentNode;
  }
  return false;
}

function hasAncestor(el: any, tag: string): boolean {
  let p = el.parentNode;
  while (p) {
    if (String(p.tagName ?? '').toUpperCase() === tag) return true;
    p = p.parentNode;
  }
  return false;
}

/** Last-resort HTML reduction when parsing/Readability yields nothing usable. */
function fallbackStrip(body: string): Section[] {
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? [{ heading: '', text, hasCode: false }] : [];
}

/**
 * Extract text from PDF bytes via unpdf (pdf.js under the hood, no native deps),
 * one section per page. Never throws: a corrupt/encrypted PDF returns a single
 * note section so the caller can fail open to native tools.
 */
export async function extractPdf(bytes: Uint8Array, url?: string): Promise<ExtractResult> {
  try {
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages: string[] = Array.isArray(text) ? text : [String(text ?? '')];
    const sections: Section[] = pages
      .map((t, i) => ({ heading: `Page ${i + 1}`, text: String(t ?? '').trim(), hasCode: false }))
      .filter(s => s.text.length > 0);
    if (sections.length === 0) {
      return { title: '', sections: [{ heading: '', text: '(PDF had no extractable text — it may be scanned/image-only.)', hasCode: false }] };
    }
    return { title: url ? url.split('/').pop() ?? '' : '', sections };
  } catch {
    return { title: '', sections: [{ heading: '', text: '(Could not parse this PDF; use native WebFetch for it.)', hasCode: false }] };
  }
}

function extractNonHtml(body: string, ct: string): ExtractResult {
  if (ct.includes('json')) {
    return { title: '', sections: [{ heading: '', text: body.trim(), hasCode: true }] };
  }
  // Markdown/plain text: split at ATX headings when present, else one section.
  const lines = body.split('\n');
  const headingIdx = lines
    .map((l, i) => (/^#{1,6}\s+/.test(l) ? i : -1))
    .filter(i => i >= 0);
  if (headingIdx.length === 0) {
    return { title: '', sections: [{ heading: '', text: body.trim(), hasCode: false }] };
  }
  const sections: Section[] = [];
  for (let k = 0; k < headingIdx.length; k++) {
    const start = headingIdx[k];
    const end = k + 1 < headingIdx.length ? headingIdx[k + 1] : lines.length;
    const heading = lines[start].replace(/^#{1,6}\s+/, '').trim();
    const text = lines.slice(start + 1, end).join('\n').trim();
    sections.push({ heading, text, hasCode: /```|\t| {4}\S/.test(text) });
  }
  const preamble = lines.slice(0, headingIdx[0]).join('\n').trim();
  if (preamble) sections.unshift({ heading: '', text: preamble, hasCode: false });
  return { title: sections[0]?.heading ?? '', sections };
}
