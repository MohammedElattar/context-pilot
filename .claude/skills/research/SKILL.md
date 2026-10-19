---
name: research
description: Use the ContextPilot Research Gateway when bug-hunting with external sources — fetching web/doc pages, PDFs, or GitHub issues/PRs, searching the open web, or when a page/thread is large. Prefer it over raw WebFetch/WebSearch to keep context small while preserving exact errors and full source.
---

# Research Gateway

When investigating with external evidence, route research through the ContextPilot
MCP tools instead of pulling raw pages into context. They fetch, extract, rank,
token-budget, and cache — preserving exact error strings, stack traces, code, and
version-specific text — and keep the full source recoverable.

## Pick the right tool (one call does the job)

- **Open-web discovery?** `contextpilot_search({ query })` → ranked result URLs +
  snippets. Then pass the URLs you want to `contextpilot_research`.
- **One known URL (web page, doc, or PDF)?** `contextpilot_fetch({ url, focus })`
  where `focus` is the error text or question.
- **A question across several URLs, or a GitHub issue/PR?**
  `contextpilot_research({ query, urls: [...] })` — fetches and ranks them all in
  ONE call (GitHub threads are compacted). Prefer this over many `fetch` calls.
- **Need a detail the budgeted evidence left out?** `contextpilot_expand({
  evidence_id })` for that one section, or `{ evidence_id, mode:"full" }` (paged)
  for the raw page.
- **Check savings?** `contextpilot_research_state()`.

## Discipline (keeps token use low — this is the point)

1. Make ONE `research`/`fetch` call with a good `focus`/`query`, then **answer from
   the returned evidence**.
2. Expand **only a specific `evidence_id`** when a needed detail is missing — do
   **not** expand every omitted section, and do **not** re-fetch the same URL.
3. Don't loop `fetch`→`expand`. If the first result is enough, stop.

Native `WebFetch`/`WebSearch` remain available as a fallback: if a gateway call
returns `ok:false`, use them directly. (If strict routing is enabled and the
gateway genuinely cannot fetch, set `CONTEXTPILOT_ALLOW_NATIVE=1`.)
