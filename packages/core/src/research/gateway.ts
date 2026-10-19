import { normalizeUrl, hashString } from './normalize.js';
import { safeFetch, FetchError, type FetchResult } from './fetch.js';
import { extract, extractPdf, type Section } from './extract.js';
import { rankSections } from './rank.js';
import { enforceBudget, estimateTokens } from './budget.js';
import { redactSecrets } from './redact.js';
import {
  putCacheEntry, putEvidence, getFreshCacheEntry, getCacheEntry,
  getEvidence, getEvidenceForUrl, evidenceId, type EvidenceRow,
} from './cache.js';
import { getDb } from '../db/connection.js';
import { recordResearch, resolveLatestSession } from './ledger.js';
import type Database from 'better-sqlite3';

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_BUDGET_TOKENS = 2000;
const MAX_BUDGET_TOKENS = 8000;
// Cap the omitted index in the response so a large page's hundreds of trimmed
// sections cannot themselves blow the token budget. The full set stays in the
// cache, recoverable by evidence_id via expand.
const MAX_OMITTED_LISTED = 25;

export interface FetchResearchArgs {
  url: string;
  /** Query/error text for relevance ranking and essential-evidence protection. */
  focus?: string;
  budget_tokens?: number;
  ttl_ms?: number;
  /** Test/caller-injected handle; defaults to the shared telemetry DB. */
  db?: Database.Database;
  /** Fetcher seam for tests; defaults to the SSRF-guarded safeFetch. */
  fetchImpl?: (url: string) => Promise<FetchResult>;
}

export interface EvidenceOut {
  evidence_id: string;
  heading: string;
  text: string;
  est_tokens: number;
  rank_score: number;
}

export type ResearchResult =
  | {
      ok: true;
      source: {
        normalized_url: string;
        final_url: string;
        status: number;
        content_type: string;
        content_hash: string;
        from_cache: boolean;
        deduplicated: boolean;
        fetched_at_ms: number;
      };
      title: string;
      focus: string | null;
      budget: { configured_tokens: number; est_tokens_in: number; est_tokens_out: number; overflow: boolean };
      evidence: EvidenceOut[];
      /** Highest-ranked omitted sections only (capped); full set recoverable via expand. */
      omitted: { evidence_id: string; heading: string; est_tokens: number }[];
      omitted_count: number;
      /** How to use this result efficiently (keeps the model from over-calling). */
      guidance: string;
      notes: string[];
    }
  | { ok: false; error: string; code: string; fallback: string };

const FALLBACK = 'Native WebFetch/WebSearch remain available as a fallback.';
const GUIDANCE = 'This is the ranked, budget-capped evidence for your focus. Answer from it directly. Expand a specific evidence_id only if a needed detail is missing — do not re-fetch this URL or expand every omitted section.';

function clampBudget(n?: number): number {
  if (!n || !Number.isFinite(n) || n <= 0) return DEFAULT_BUDGET_TOKENS;
  return Math.min(Math.floor(n), MAX_BUDGET_TOKENS);
}

function inferHasCode(text: string): boolean {
  return /```|\n {2,}\S|\t\S/.test(text);
}

/**
 * Fetch (or cache-hit) one URL, reduce it to budget-capped ranked evidence with
 * stable ids, and persist full evidence for later expand. Fail-open: any error
 * returns ok:false with a fallback note rather than throwing.
 */
export async function fetchResearch(args: FetchResearchArgs): Promise<ResearchResult> {
  const db = args.db ?? getDb();
  const result = await runFetch(args, db);

  // Record the call for contextpilot_research_state (fail-open).
  let urlHash: string | null = null;
  let normalized: string | null = null;
  try { const n = normalizeUrl(args.url); urlHash = n.urlHash; normalized = n.normalized; } catch { /* bad url */ }
  recordResearch({
    session_id: resolveLatestSession(db),
    url_hash: urlHash,
    normalized_url: result.ok ? result.source.normalized_url : normalized,
    focus: args.focus?.trim() || null,
    tool: 'contextpilot_fetch',
    cache_hit: result.ok ? result.source.from_cache : false,
    deduplicated: result.ok ? result.source.deduplicated : false,
    est_tokens_in: result.ok ? result.budget.est_tokens_in : null,
    est_tokens_out: result.ok ? result.budget.est_tokens_out : null,
    est_tokens_saved: result.ok ? Math.max(0, result.budget.est_tokens_in - result.budget.est_tokens_out) : null,
    ok: result.ok,
    code: result.ok ? null : result.code,
  }, db);

  return result;
}

async function runFetch(args: FetchResearchArgs, db: Database.Database): Promise<ResearchResult> {
  const budget = clampBudget(args.budget_tokens);
  const focus = args.focus?.trim() || undefined;
  const ttl = args.ttl_ms && args.ttl_ms > 0 ? args.ttl_ms : DEFAULT_TTL_MS;

  let norm;
  try {
    norm = normalizeUrl(args.url);
  } catch {
    return { ok: false, error: `Invalid URL: ${args.url}`, code: 'bad_url', fallback: FALLBACK };
  }

  // Cache-first: a fresh entry means no network.
  const fresh = getFreshCacheEntry(norm.urlHash, Date.now(), db);
  if (fresh) {
    const rows = getEvidenceForUrl(norm.urlHash, db);
    const sections: Section[] = rows.map(r => ({
      heading: r.heading ?? '',
      text: r.text,
      hasCode: inferHasCode(r.text),
    }));
    return buildResult({
      sections, focus, budget,
      source: {
        normalized_url: norm.normalized,
        final_url: fresh.final_url ?? norm.normalized,
        status: fresh.status ?? 200,
        content_type: fresh.content_type ?? '',
        content_hash: fresh.content_hash ?? '',
        from_cache: true,
        deduplicated: false,
        fetched_at_ms: fresh.fetched_at_ms,
      },
      title: '',
      extraNotes: ['Served from cache (no network request).'],
    });
  }

  // Cache miss → network fetch behind the SSRF guard.
  let fetched;
  try {
    fetched = await (args.fetchImpl ?? safeFetch)(norm.normalized);
  } catch (err) {
    const code = err instanceof FetchError ? err.code : 'network';
    return { ok: false, error: err instanceof Error ? err.message : String(err), code, fallback: FALLBACK };
  }

  if (fetched.status >= 400) {
    return { ok: false, error: `Upstream returned HTTP ${fetched.status}`, code: `http_${fetched.status}`, fallback: FALLBACK };
  }

  // PDF → extract from raw bytes (the utf-8 body would be corrupt); the cache
  // body then holds the extracted text so expand returns readable content.
  const isPdf = /pdf/i.test(fetched.contentType) || /\.pdf($|\?)/i.test(norm.normalized);
  let safeBody: string;
  let extracted;
  if (isPdf) {
    const bytes = fetched.bodyBytes ?? Buffer.from(fetched.body, 'utf-8');
    extracted = await extractPdf(bytes, fetched.finalUrl);
    safeBody = redactSecrets(extracted.sections.map(s => s.text).join('\n\n'));
  } else {
    safeBody = redactSecrets(fetched.body);
    extracted = extract({ body: safeBody, contentType: fetched.contentType, url: fetched.finalUrl });
  }
  const contentHash = hashString(safeBody);

  // Content-hash dedup: has this exact content been cached under another URL?
  let deduplicated = false;
  try {
    const dup = db.prepare('SELECT COUNT(*) AS n FROM research_cache WHERE content_hash = ? AND url_hash != ?')
      .get(contentHash, norm.urlHash) as { n: number } | undefined;
    deduplicated = (dup?.n ?? 0) > 0;
  } catch { /* ignore */ }

  const fetchedAt = Date.now();
  putCacheEntry({
    url_hash: norm.urlHash,
    normalized_url: norm.normalized,
    final_url: fetched.finalUrl,
    content_hash: contentHash,
    content_type: fetched.contentType,
    status: fetched.status,
    body: safeBody,
    body_bytes: fetched.bytes,
    est_tokens: estimateTokens(safeBody),
    fetched_at_ms: fetchedAt,
    ttl_ms: ttl,
    source: 'research_gateway',
  }, db);

  const evidenceRows: EvidenceRow[] = extracted.sections.map((s, index) => ({
    evidence_id: evidenceId(contentHash, index),
    url_hash: norm.urlHash,
    content_hash: contentHash,
    section_index: index,
    heading: s.heading,
    text: s.text,
    est_tokens: estimateTokens(s.text),
    rank_score: null,
  }));
  putEvidence(evidenceRows, db);

  const notes: string[] = [];
  if (fetched.truncated) notes.push(`Body truncated at the fetch size cap (${fetched.bytes} bytes kept).`);
  if (deduplicated) notes.push('Identical content already cached under another URL (deduplicated).');

  return buildResult({
    sections: extracted.sections, focus, budget,
    source: {
      normalized_url: norm.normalized,
      final_url: fetched.finalUrl,
      status: fetched.status,
      content_type: fetched.contentType,
      content_hash: contentHash,
      from_cache: false,
      deduplicated,
      fetched_at_ms: fetchedAt,
    },
    title: extracted.title,
    extraNotes: notes,
  });
}

function buildResult(input: {
  sections: Section[];
  focus?: string;
  budget: number;
  source: Extract<ResearchResult, { ok: true }>['source'];
  title: string;
  extraNotes: string[];
}): ResearchResult {
  const ranked = rankSections(input.sections, input.focus);
  const { included, omitted, estTokensIn, estTokensOut, overflow } = enforceBudget(ranked, input.budget);

  const contentHash = input.source.content_hash;
  const notes = [...input.extraNotes];
  if (overflow) notes.push('Essential (error-matching) evidence exceeded the budget and was kept anyway.');
  if (omitted.length > 0) notes.push(`${omitted.length} lower-ranked section(s) omitted — recover with contextpilot_expand.`);

  return {
    ok: true,
    source: input.source,
    title: input.title,
    focus: input.focus ?? null,
    budget: { configured_tokens: input.budget, est_tokens_in: estTokensIn, est_tokens_out: estTokensOut, overflow },
    evidence: included.map(s => ({
      evidence_id: evidenceId(contentHash, s.index),
      heading: s.heading,
      text: redactSecrets(s.text),
      est_tokens: estimateTokens(s.text),
      rank_score: s.score,
    })),
    omitted: omitted.slice(0, MAX_OMITTED_LISTED).map(s => ({
      evidence_id: evidenceId(contentHash, s.index),
      heading: s.heading,
      est_tokens: estimateTokens(s.text),
    })),
    omitted_count: omitted.length,
    guidance: GUIDANCE,
    notes,
  };
}

export interface ExpandArgs {
  evidence_id: string;
  mode?: 'section' | 'full';
  /** mode:"full" only — start character offset into the page body (default 0). */
  offset?: number;
  /** mode:"full" only — max characters to return in this window (default cap). */
  limit?: number;
  db?: Database.Database;
}

export type ExpandResult =
  | {
      ok: true;
      evidence_id: string;
      mode: 'section' | 'full';
      heading: string;
      text: string;
      est_tokens: number;
      /** mode:"full": true when the body was windowed and more remains. */
      truncated?: boolean;
      /** mode:"full": pass this as `offset` to read the next window. */
      next_offset?: number;
      /** mode:"full": total characters in the full body. */
      total_chars?: number;
      source: { normalized_url: string; final_url: string };
    }
  | { ok: false; error: string; code: string; fallback: string };

// Windowing cap for mode:"full" so a single expand cannot dump a whole large
// page back into context (~4,000 est tokens). Page over the cap → paged via
// offset/next_offset. Keeps expand from undoing the budget trim.
const EXPAND_FULL_CHAR_CAP = 16_000;

/**
 * Recover omitted or fuller evidence by stable id — cache-only, never a network
 * request. 'section' returns the full stored section; 'full' returns a windowed
 * slice of the original (redacted) page body, capped and paged so it cannot
 * re-balloon context.
 */
export function expandEvidence(args: ExpandArgs): ExpandResult {
  const db = args.db ?? getDb();
  const mode = args.mode ?? 'section';
  const ev = getEvidence(args.evidence_id, db);
  if (!ev) {
    return { ok: false, error: `Unknown evidence_id: ${args.evidence_id}`, code: 'not_found', fallback: FALLBACK };
  }
  const entry = getCacheEntry(ev.url_hash, db);
  const source = {
    normalized_url: entry?.normalized_url ?? '',
    final_url: entry?.final_url ?? entry?.normalized_url ?? '',
  };

  if (mode === 'full') {
    const body = redactSecrets(entry?.body ?? ev.text);
    const offset = Math.max(0, Math.floor(args.offset ?? 0));
    const cap = args.limit && args.limit > 0 ? Math.floor(args.limit) : EXPAND_FULL_CHAR_CAP;
    const slice = body.slice(offset, offset + cap);
    const truncated = offset + cap < body.length;
    return {
      ok: true, evidence_id: args.evidence_id, mode, heading: ev.heading ?? '',
      text: slice, est_tokens: estimateTokens(slice),
      truncated, next_offset: truncated ? offset + cap : undefined, total_chars: body.length,
      source,
    };
  }
  return {
    ok: true, evidence_id: args.evidence_id, mode: 'section', heading: ev.heading ?? '',
    text: redactSecrets(ev.text), est_tokens: ev.est_tokens ?? estimateTokens(ev.text), source,
  };
}
