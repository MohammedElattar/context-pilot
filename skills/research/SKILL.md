---
name: research
description: Use the ContextPilot Research Gateway when bug-hunting with external sources — fetching web/doc pages or GitHub issues/PRs, or when a page/thread is large. Prefer it over raw WebFetch/WebSearch to keep context small while preserving exact errors and full source.
---

# Research Gateway

When investigating a bug with external evidence, route research through the
ContextPilot MCP tools instead of pulling raw pages into context. They fetch,
extract, rank, token-budget, and cache — preserving exact error strings, stack
traces, code, and version-specific text — and keep the full source recoverable.

## Tools

- `contextpilot_research({ query, urls, budget_tokens? })` — research a question
  across one or more URLs at once (web/doc pages, GitHub issue/PR URLs, or
  `owner/repo#n`). Returns merged, ranked, budgeted evidence with per-source
  provenance; long GitHub threads are compacted (body + head/tail + maintainer
  comments kept). For open-web discovery, run native `WebSearch` first, then pass
  the chosen URLs here.
- `contextpilot_fetch({ url, focus?, budget_tokens? })` — fetch and reduce one
  URL. `focus` = the error text or question; sections matching it exactly are
  never dropped. Repeat fetches hit the local cache (no network, no new tokens).
- `contextpilot_expand({ evidence_id, mode? })` — recover an omitted section
  (`mode:"section"`) or the entire original page (`mode:"full"`) by its stable
  `evidence_id`, from cache, with no network request.
- `contextpilot_research_state()` — routing adoption (gateway vs native),
  cache hit-rate, and estimated tokens saved for the session.

## How to use it

1. Have a URL or GitHub issue/PR? Call `contextpilot_research` (or
   `contextpilot_fetch` for a single page) with the error text as `focus`/`query`.
2. Read the returned evidence. Need a section it omitted, or the full page? Call
   `contextpilot_expand` with the `evidence_id` — no refetch.
3. Only need open-web discovery? Use native `WebSearch`, then feed the URLs to
   `contextpilot_research`.

Native `WebFetch`/`WebSearch` remain available as a fallback; if a gateway call
returns `ok:false`, use them directly.
