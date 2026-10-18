import { fetchResearch, type EvidenceOut } from './gateway.js';
import { parseGitHubRef, fetchGitHubMarkdown, type GhExec } from './github.js';
import type { FetchResult } from './fetch.js';
import { getDb } from '../db/connection.js';
import type Database from 'better-sqlite3';

const DEFAULT_BUDGET = 3000;
const MAX_BUDGET = 8000;
const MAX_OMITTED_LISTED = 25;

export interface ResearchQueryArgs {
  query: string;
  /** URLs/refs to research: web/doc pages or GitHub issue/PR URLs (or owner/repo#n). */
  urls?: string[];
  budget_tokens?: number;
  db?: Database.Database;
  fetchImpl?: (url: string) => Promise<FetchResult>;
  ghExec?: GhExec;
  preferGh?: boolean;
}

export interface ResearchSource {
  url: string;
  kind: 'web' | 'github';
  ok: boolean;
  from_cache?: boolean;
  status?: number;
  code?: string;
}

export interface ResearchQueryResult {
  ok: true;
  query: string;
  sources: ResearchSource[];
  evidence: (EvidenceOut & { source_url: string })[];
  omitted: { evidence_id: string; source_url: string; heading: string; est_tokens: number }[];
  omitted_count: number;
  budget: { configured_tokens: number; est_tokens_available: number; est_tokens_out: number };
  notes: string[];
}

function clampBudget(n?: number): number {
  if (!n || !Number.isFinite(n) || n <= 0) return DEFAULT_BUDGET;
  return Math.min(Math.floor(n), MAX_BUDGET);
}

/**
 * Research a question across multiple provided URLs (web/docs and GitHub
 * issues/PRs), fetching each through the gateway, then merge and re-rank the
 * evidence under one global token budget with per-source provenance. GitHub
 * refs are rendered to compacted markdown and run through the same pipeline, so
 * cache, dedup, budget, expand and the ledger all apply uniformly. Fail-open:
 * a bad source is reported in `sources`, never thrown.
 */
export async function researchQuery(args: ResearchQueryArgs): Promise<ResearchQueryResult> {
  const db = args.db ?? getDb();
  const budget = clampBudget(args.budget_tokens);
  const query = args.query?.trim() ?? '';
  const urls = args.urls ?? [];

  const base: ResearchQueryResult = {
    ok: true, query, sources: [], evidence: [], omitted: [], omitted_count: 0,
    budget: { configured_tokens: budget, est_tokens_available: 0, est_tokens_out: 0 },
    notes: [],
  };

  if (urls.length === 0) {
    base.notes.push('No URLs supplied. contextpilot_research fetches and ranks URLs you provide (web/doc pages, GitHub issues/PRs). For open-web discovery, use native WebSearch, then pass the resulting URLs here.');
    return base;
  }

  const sources: ResearchSource[] = [];
  const allEvidence: (EvidenceOut & { source_url: string })[] = [];
  let available = 0;

  for (const raw of urls) {
    const ref = parseGitHubRef(raw);
    try {
      let fetchImpl = args.fetchImpl;
      let targetUrl = raw;
      if (ref) {
        const { markdown, url } = await fetchGitHubMarkdown(ref, { ghExec: args.ghExec, fetchImpl: args.fetchImpl as any, preferGh: args.preferGh });
        targetUrl = url;
        const bytes = Buffer.byteLength(markdown);
        fetchImpl = async (u: string): Promise<FetchResult> => ({ finalUrl: u, status: 200, contentType: 'text/markdown', body: markdown, bytes, truncated: false });
      }
      const res = await fetchResearch({ url: targetUrl, focus: query, budget_tokens: budget, db, fetchImpl });
      if (res.ok) {
        sources.push({ url: targetUrl, kind: ref ? 'github' : 'web', ok: true, from_cache: res.source.from_cache, status: res.source.status });
        available += res.budget.est_tokens_in;
        for (const e of res.evidence) allEvidence.push({ ...e, source_url: targetUrl });
      } else {
        sources.push({ url: targetUrl, kind: ref ? 'github' : 'web', ok: false, code: res.code });
      }
    } catch (err) {
      sources.push({ url: raw, kind: ref ? 'github' : 'web', ok: false, code: 'provider_error' });
    }
  }

  // Global merge: dedup identical evidence, rank across sources, enforce one budget.
  const seen = new Set<string>();
  const unique = allEvidence.filter(e => (seen.has(e.evidence_id) ? false : (seen.add(e.evidence_id), true)));
  unique.sort((a, b) => b.rank_score - a.rank_score);

  const included: (EvidenceOut & { source_url: string })[] = [];
  let used = 0;
  for (const e of unique) {
    if (used + e.est_tokens > budget) continue;
    included.push(e);
    used += e.est_tokens;
  }
  const includedIds = new Set(included.map(e => e.evidence_id));
  const omitted = unique.filter(e => !includedIds.has(e.evidence_id));

  base.sources = sources;
  base.evidence = included;
  base.omitted = omitted.slice(0, MAX_OMITTED_LISTED).map(e => ({ evidence_id: e.evidence_id, source_url: e.source_url, heading: e.heading, est_tokens: e.est_tokens }));
  base.omitted_count = omitted.length;
  base.budget = { configured_tokens: budget, est_tokens_available: available, est_tokens_out: used };
  if (omitted.length > 0) base.notes.push(`${omitted.length} lower-ranked section(s) across sources omitted — recover with contextpilot_expand.`);
  if (sources.every(s => !s.ok)) base.notes.push('All sources failed; native WebFetch/WebSearch remain available.');
  return base;
}
