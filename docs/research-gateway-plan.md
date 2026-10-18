# ContextPilot Research Gateway — Plan

## Problem

Claude Code bug-hunting spends large amounts of context on external research:
WebSearch, WebFetch, GitHub issues/PRs, external MCP servers, and `gh`/`curl`
Bash calls. Raw HTML, long docs, and 100-comment threads enter context verbatim,
often duplicated across a session, with no dedup, caching, ranking, or budget.
Caveman compresses output tokens on the wire; it does not pre-digest research
content before it enters context.

## Goal

A local-first research layer that fetches, caches, deduplicates, extracts,
ranks, and budgets external evidence **before** it reaches Claude, while
preserving (a) debugging accuracy — exact error strings, stack traces, code, and
version-specific docs are never dropped — and (b) the ability to expand back to
complete original evidence on demand. Outcome: solve the same bugs with less
research context, with full source still retrievable.

## Confirmed decisions

- **Routing model:** MCP-tools-first + a non-blocking PreToolUse advisory (later
  slice). Native WebSearch/WebFetch/`gh` stay as fallback. **No native
  tool-output rewriting** — PostToolUse `updatedToolOutput` shape is undocumented
  for web tools and Caveman already owns PostToolUse.
- **GitHub (later slice):** shell to `gh api` when present; fall back to
  unauthenticated `api.github.com` for public repos. No token handling.
- **HTML extraction:** `linkedom` + `@mozilla/readability` in `@contextpilot/core`.
- **Adoption (later slice):** a concise research skill + `contextpilot setup
  --research` opt-in flag. Strict routing OFF by default.

## Hard constraints (honored)

- Read-only Caveman access; never touch its config/DBs/files/hooks.
- Hooks write nothing to stdout; advisors emit plain stdout only, exit 0, fail
  silent. A future PreToolUse advisory stays non-blocking (`allow`/exit 0), never
  `deny`/`exit 2`, and uses events Caveman does not own.
- Fail-open everywhere; no secrets in output (redaction); Zod `.passthrough()` on
  external-data schemas.
- MCP responses use the house format `{content:[{type:'text',
  text:JSON.stringify(result,null,2)}]}` and are budget-capped well under the
  25,000-token MCP limit.

## Architecture (`packages/core/src/research/`)

- `normalize.ts` — URL canonicalization + stable `url_hash`/`content_hash`
  (sha256 slice).
- `fetch.ts` — SSRF-safe fetch via `node:http(s)` with a DNS-lookup guard that
  validates the connected address (closes the DNS-rebinding gap), manual
  redirect re-validation, a body cap, and a timeout.
- `extract.ts` — `linkedom` + Readability for HTML main content; `<pre>` kept
  verbatim; markdown/text/JSON passthrough; malformed HTML falls back to a strip,
  never throws.
- `rank.ts` — relevance by focus-term overlap + error/code density; verbatim
  focus match flags a section as protected.
- `budget.ts` — token budget enforcement; protected (error-matching) sections are
  included first and never dropped; the rest fill the remaining budget by score.
- `cache.ts` — SQLite cache (`research_cache`) with TTL + content fingerprint,
  and `research_evidence` keyed `${content_hash}:${section_index}` so identical
  content from different URLs collapses (INSERT OR IGNORE).
- `redact.ts` — credential masking applied before content is returned, cached, or
  logged.
- `gateway.ts` — orchestration (`fetchResearch`, `expandEvidence`).

### DB (`packages/core/src/db/connection.ts`)

Migration `007-research-cache` adds `research_cache` and `research_evidence`
(idempotent `CREATE TABLE IF NOT EXISTS`, reusing the existing migration idiom).
Reuses the telemetry DB (`~/.context-pilot/telemetry.db`).

## MCP tools

- `contextpilot_fetch` — fetch/cache one URL, return ranked budget-capped evidence
  with stable `evidence_id`s, `focus` for query-aware ranking.
- `contextpilot_expand` — recover a fuller/omitted section or the full body by
  `evidence_id`, cache-only (no network).
- `contextpilot_research`, `contextpilot_research_state` — later slices.

## Slices

1. **(this run)** `contextpilot_fetch` end-to-end + `contextpilot_expand` +
   `research_cache`/`research_evidence` + tests. STOP and verify.
2. `contextpilot_expand` TTL/stale-cache tests + hardening.
3. `contextpilot_research` providers (web/docs/github).
4. Ledger + `contextpilot_research_state` + routed-vs-bypassed telemetry.
5. Skill, PreToolUse advisory, observer tagging, `setup --research`, dashboard
   metric.
6. Benchmark real bug-hunting workflows vs baseline.

## Safety

Fail-open (gateway down → native tools work). Read-only Caveman. Secret
redaction. Additive + opt-in. SSRF + DNS-rebinding + unsafe-redirect +
oversized-response + cache-poisoning (content-hash keyed, TTL) guards. Retrieved
content is untrusted data, never executed or followed as instructions. Essential
evidence (exact error match) is never silently dropped by budget trimming.
