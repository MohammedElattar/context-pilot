import { safeFetch } from './fetch.js';
import { redactSecrets } from './redact.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchResponse =
  | { ok: true; provider: 'searxng' | 'brave'; query: string; results: SearchResult[] }
  | { ok: false; code: string; error: string; fallback: string };

export interface SearchOpts {
  limit?: number;
  /** Overrides for tests; default to env (CONTEXTPILOT_SEARXNG_URL / BRAVE_API_KEY). */
  searxngUrl?: string;
  braveKey?: string;
  fetchImpl?: typeof safeFetch;
}

const FALLBACK =
  'No search backend configured. Use native WebSearch, then pass the chosen URLs to contextpilot_research. To enable contextpilot_search, set CONTEXTPILOT_SEARXNG_URL (free, self-hosted) or BRAVE_API_KEY.';

/**
 * Turn a free-text query into ranked result URLs + snippets (small — not page
 * bodies). SearXNG first (free, self-hosted), then Brave if a key is set, else
 * a fail-open note pointing at native WebSearch. The model then feeds the chosen
 * URLs to contextpilot_research.
 */
export async function searchWeb(query: string, opts: SearchOpts = {}): Promise<SearchResponse> {
  const q = (query ?? '').trim();
  if (!q) return { ok: false, code: 'bad_args', error: 'Empty query.', fallback: FALLBACK };
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);
  const fetcher = opts.fetchImpl ?? safeFetch;

  const searxng = (opts.searxngUrl ?? process.env.CONTEXTPILOT_SEARXNG_URL ?? '').trim();
  const brave = (opts.braveKey ?? process.env.BRAVE_API_KEY ?? '').trim();

  if (searxng) return searchSearxng(q, limit, searxng, fetcher);
  if (brave) return searchBrave(q, limit, brave, fetcher);
  return { ok: false, code: 'no_backend', error: 'No search backend configured.', fallback: FALLBACK };
}

async function searchSearxng(q: string, limit: number, base: string, fetcher: typeof safeFetch): Promise<SearchResponse> {
  try {
    const root = base.replace(/\/+$/, '');
    const u = new URL(root + '/search');
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'json');
    u.searchParams.set('safesearch', '1');
    const host = new URL(root).hostname;
    const res = await fetcher(u.toString(), { allowPrivateHost: host, timeoutMs: 10_000 });
    if (res.status >= 400) {
      return { ok: false, code: `http_${res.status}`, error: `SearXNG returned HTTP ${res.status}. Is the JSON API enabled (search.formats: [json])?`, fallback: FALLBACK };
    }
    const data = JSON.parse(res.body) as { results?: any[] };
    const results = (data.results ?? []).slice(0, limit).map(normalizeResult);
    return { ok: true, provider: 'searxng', query: q, results };
  } catch (err) {
    return { ok: false, code: 'network', error: err instanceof Error ? err.message : String(err), fallback: FALLBACK };
  }
}

async function searchBrave(q: string, limit: number, key: string, fetcher: typeof safeFetch): Promise<SearchResponse> {
  try {
    const u = new URL('https://api.search.brave.com/res/v1/web/search');
    u.searchParams.set('q', q);
    u.searchParams.set('count', String(limit));
    const res = await fetcher(u.toString(), { headers: { 'X-Subscription-Token': key, Accept: 'application/json' }, timeoutMs: 10_000 });
    if (res.status >= 400) {
      return { ok: false, code: `http_${res.status}`, error: `Brave Search returned HTTP ${res.status}.`, fallback: FALLBACK };
    }
    const data = JSON.parse(res.body) as { web?: { results?: any[] } };
    const results = (data.web?.results ?? []).slice(0, limit).map(normalizeResult);
    return { ok: true, provider: 'brave', query: q, results };
  } catch (err) {
    return { ok: false, code: 'network', error: err instanceof Error ? err.message : String(err), fallback: FALLBACK };
  }
}

function normalizeResult(r: any): SearchResult {
  return {
    title: String(r?.title ?? ''),
    url: String(r?.url ?? ''),
    snippet: redactSecrets(String(r?.content ?? r?.description ?? '')).slice(0, 300),
  };
}
