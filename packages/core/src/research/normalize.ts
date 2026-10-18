import { createHash } from 'node:crypto';

/** Query params stripped during normalization (tracking noise, not content). */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'mc_cid', 'mc_eid',
  'ref', 'ref_src', 'ref_url', 'igshid', 'spm', '_hsenc', '_hsmi',
]);

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

export interface NormalizedUrl {
  /** Canonical URL string. */
  normalized: string;
  /** Stable 32-char sha256 slice of the normalized URL. */
  urlHash: string;
}

/**
 * Canonicalize a URL so semantically identical links hash to the same key:
 * lowercase host, drop default port, strip fragment and tracking params,
 * sort the remaining query, and trim a trailing slash on non-root paths.
 * Throws on an unparseable URL — the caller decides how to fail open.
 */
export function normalizeUrl(raw: string): NormalizedUrl {
  const u = new URL(raw.trim());

  u.hostname = u.hostname.toLowerCase();
  if (u.port && DEFAULT_PORTS[u.protocol] === u.port) u.port = '';
  u.hash = '';

  const kept: [string, string][] = [];
  for (const [k, v] of u.searchParams) {
    if (!TRACKING_PARAMS.has(k.toLowerCase())) kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);

  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }

  const normalized = u.toString();
  return { normalized, urlHash: hashString(normalized) };
}

/** Stable 32-char sha256 slice — used for url_hash and content_hash. */
export function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
