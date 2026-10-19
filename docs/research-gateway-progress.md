# Research Gateway — Progress

## Status: Slices 1–6 complete and verified, INCLUDING live-network runs.

### Live-network verification (actually run, real URLs)
Node `node:http(s)` is blocked in this sandbox but undici `fetch` works, so
`safeFetch` gained a `fetch`-based fallback transport (SSRF still enforced:
pre-resolve + reject private, scheme check, manual redirect re-validation, body
cap; connection errors fall back, SSRF/scheme blocks never do).

- **Live `safeFetch`**: `https://example.com/` → 200, 577 bytes.
- **Live MCP stdio `contextpilot_fetch`** on `https://nodejs.org/api/errors.html`
  (focus `ERR_INVALID_ARG_TYPE`): raw **414,999 B / 103,738 est tokens** → final
  MCP response **3,333 est tokens = 96.8% reduction**, 6 evidence sections, exact
  error preserved, 25 omitted recoverable, `ok:true`.
- **Live CLI `benchmark --research`** on the same URL: native **103,738** vs
  gateway **3,517** est tokens = **96.6% reduction**; latency native 858ms /
  gateway 122ms; both arms resolved.
- **Live GitHub provider** (unauthenticated API fallback) on
  `github.com/sindresorhus/slugify/issues/1`: `ok:true`, `kind:github`, status
  200, issue extracted.
- Full suite after the fallback: **30 files, 143 tests passed**; SSRF guard tests
  still block (no fallthrough). `tsc` core clean.

Still NOT measured (needs the Claude CLI): live `claude -p` TASK-SUCCESS numbers.
The benchmark's `resolved` remains a proxy (answer present in model-visible text).

## Slice 1 — `contextpilot_fetch` + `contextpilot_expand` (DONE)

End-to-end path: normalize → SSRF-safe fetch → extract (Readability, verbatim
code/errors) → focused rank → SQLite cache (TTL + content-hash dedup, stable
evidence ids) → token budget → MCP response. Plus minimal `contextpilot_expand`
to recover omitted/full evidence from cache with no network.

### New files
- `packages/core/src/research/{normalize,fetch,extract,rank,budget,cache,redact,gateway,index}.ts`
- `packages/core/src/research/{normalize,fetch,gateway}.test.ts`
- `packages/mcp/src/tools/{research-fetch,research-expand}.ts`
- `docs/research-gateway-plan.md`, `docs/research-gateway-progress.md`

### Modified files
- `packages/core/src/db/connection.ts` — migration `007-research-cache`
  (`research_cache`, `research_evidence`).
- `packages/core/src/index.ts` — export the research module.
- `packages/core/package.json` — add `linkedom`, `@mozilla/readability`.
- `packages/mcp/src/index.ts` — register `contextpilot_fetch` / `contextpilot_expand`.

### Verification (actually run)
- Build: `pnpm -r build` — core/cli/mcp all "Build success".
- Typecheck: `tsc --noEmit` — **core clean**. Pre-existing errors in
  cli/mcp files not touched by this slice (`analyze/status/dashboard/policies.ts`,
  `mcp/src/tools/budget.ts`: missing `@types/better-sqlite3` devdep + implicit
  `any`); not introduced here, not in scope to fix.
- Tests: `vitest run --pool=forks --poolOptions.forks.singleFork=true` —
  **24 files, 123 tests passed** (20 new research tests: normalize 5, fetch 7,
  gateway 8). Covered: repeated query (cache hit, no 2nd fetch), duplicate-page
  content-hash dedup, large-doc budget trim, exact-error verbatim preservation,
  malformed HTML (no throw), failed fetch (fail-open), sensitive URL / SSRF
  block, expand of omitted section and full body.
- MCP stdio e2e (real server over stdio): tools/list shows all 5 tools incl.
  `contextpilot_fetch`/`contextpilot_expand`; blocked metadata URL
  (`169.254.169.254`) → `ok:false, code:ssrf_blocked` with fallback; expand of an
  unknown id → `ok:false, code:not_found`.

### Real-page measurement (estimates; chars/4)
Page: `https://nodejs.org/api/errors.html`, focus `ERR_INVALID_ARG_TYPE`,
budget 2000 tokens. Page captured via `curl` and fed through the real
extract→rank→budget pipeline (the **network hop was stubbed** because this
sandbox blocks Node outbound sockets — `curl` works, Node `fetch`/`https` were
intermittently blocked; extraction/ranking/budget/serialization are real).

| Metric | Value |
|---|---|
| Raw fetched bytes | 414,999 |
| Est. raw HTML tokens | 103,738 |
| Est. extracted content tokens (all 497 sections) | 20,667 |
| Est. final MCP response tokens | 3,315 |
| Configured budget | 2,000 |
| Est. evidence tokens returned | 1,999 |
| Evidence sections returned | 6 |
| Sections omitted (recoverable via expand) | 491 (25 indexed in response) |
| Exact error preserved verbatim | yes |
| **Raw-HTML reduction (raw → final MCP response)** | **96.8%** |

This is an estimated **raw-HTML reduction**, NOT a measured delta against native
WebFetch (which does its own summarization). A true native-tool savings number
requires the benchmark harness in Slice 6.

### Bug found and fixed during verification
First measurement showed a 20,095-token MCP response despite a 2,000 budget: the
response enumerated all 491 omitted sections. Fixed by capping the omitted index
to 25 (`MAX_OMITTED_LISTED`) with an `omitted_count`; full set stays in cache,
recoverable by `evidence_id`. Response dropped to 3,315 tokens.

### Safety confirmed
- Caveman untouched: no writes to `~/.claude` or `~/.caveman` by this slice;
  settings.json still carries its Caveman hooks. All writes were under the repo
  and `~/.context-pilot/telemetry.db` (ContextPilot's own DB).
- SSRF guard blocks loopback/private/link-local/CGNAT/metadata (IPv4+IPv6+mapped),
  non-http(s) schemes, and re-validates each redirect hop; the DNS lookup is
  validated at connect time (no rebinding gap).
- Secret redaction applied before content is returned, cached, or expanded.
- Fail-open: every error returns a structured `ok:false` with a fallback note;
  native WebFetch/WebSearch remain usable.

## Known limitations / follow-ups
- **Node 24 + better-sqlite3 teardown assertion** (`RemoveEnvironmentCleanupHook`,
  `Statement::~Statement`): FIXED by bumping `better-sqlite3` 11.10.0 → **13.0.3**
  in `@contextpilot/core`. It had aborted the `dashboard` command at runtime and
  forced `--pool=forks` in tests. After the bump: `dashboard` survives sustained
  DB queries with no abort, and the full suite passes on the **default** vitest
  pool (**30 files, 143 tests**). No `--pool=forks` workaround needed.
- Live network fetch could not be exercised end-to-end in this sandbox (Node
  egress blocked). The SSRF-block, cache-hit, extract, rank, budget, and MCP
  paths are all verified; the real socket fetch is exercised only by the
  guard-rejection cases. Validate a live 200-fetch in an unrestricted env.
- Token counts are chars/4 estimates, labelled as such. A real tokenizer is a
  later refinement.
- Ranking is lexical (term overlap + error/code density); no embeddings.

## Slice 4 — session ledger + `contextpilot_research_state` (DONE)

Records one `research_ledger` row per gateway call; `contextpilot_research_state`
summarizes a session: routed gateway calls vs native WebFetch/WebSearch (routing
adoption), cache hit-rate, failures, and estimated within-gateway token savings.

### Files
- New: `packages/core/src/research/ledger.ts`, `ledger.test.ts`;
  `packages/mcp/src/tools/research-state.ts`.
- Modified: `connection.ts` (migration `008-research-ledger`), `research/index.ts`,
  `core/src/index.ts`, `research/gateway.ts` (record at single exit),
  `mcp/src/index.ts` (register tool).

### Verification (actually run)
- `pnpm -r build` OK; `tsc --noEmit` core clean.
- Tests: **25 files, 126 passed** (3 new ledger tests: aggregation, adoption vs
  native WebFetch, null adoption when idle).
- MCP stdio e2e: 6 tools listed incl. `contextpilot_research_state`; the tool
  returns `{routed_calls, cache_hits, failed_calls, bypassed_native_calls,
  routing_adoption_rate, est_tokens_saved}` for the live session.

### Limitation
`est_tokens_saved` here is the within-gateway trim (extracted_in − returned_out),
not a raw-HTML or native-tool delta; labelled as an estimate.

## Slice 3 — `contextpilot_research` (multi-source) (DONE)

Researches a question across provided URLs — web/doc pages and GitHub issues/PRs
(URL or `owner/repo#n`) — in one call: fetches each through the gateway, merges
and re-ranks evidence under one global token budget with per-source provenance.
GitHub refs are rendered to compacted markdown (title + body + head/tail + all
maintainer comments verbatim; middle thread replaced by an "N omitted" line, full
thread cached) and run through the same pipeline, so cache/dedup/budget/expand/
ledger all apply. `gh` is used when present (user's auth), with an unauthenticated
API fallback. Open-web discovery is explicitly delegated to native WebSearch
(no search backend); the tool returns guidance when given no URLs.

### Files
- New: `packages/core/src/research/github.ts`, `research.ts`, `github.test.ts`,
  `research.test.ts`; `packages/mcp/src/tools/research.ts`.
- Modified: `research/index.ts`, `core/src/index.ts`, `mcp/src/index.ts`
  (register `contextpilot_research`).

### Verification (actually run)
- `pnpm -r build` OK; `tsc --noEmit` core clean.
- Tests: **27 files, 133 passed** (6 new: GitHub ref parse, thread compaction
  with a stubbed `gh`, multi-source web merge with provenance + budget, GitHub
  issue research via stubbed `gh` with error preserved, failed-source fail-open).
- MCP stdio e2e: **7 tools** listed incl. `contextpilot_research`; a no-URL call
  returns the WebSearch-delegation guidance note.

### Limitations
- Live web/doc provider fetches need egress; this sandbox blocks Node outbound
  sockets (only `curl` works), so a real 200-fetch through `contextpilot_research`
  / `contextpilot_fetch` could not be proven here. All logic that does not require
  live egress (GitHub via stubbed `gh`, merge, dedup, budget, cache, expand,
  ledger, SSRF rejection) is verified; validate a live fetch in an unrestricted env.
- Per-source fetch uses the full budget, then a global budget is enforced on the
  merged set (not a per-source split).

## Slice 5 — adoption (skill, advisory, setup, dashboard) (DONE)

- **Skill** `skills/research/SKILL.md`: when to use the gateway tools vs native.
- **PreToolUse `research-advisor`** (`packages/cli/src/hooks/research-advisor.ts`
  + pure `research-advisor-logic.ts`): on WebFetch/WebSearch or a network Bash
  command, emits a one-line suggestion via `hookSpecificOutput.additionalContext`
  ONLY — never `permissionDecision`, so it cannot block a tool or override
  Caveman's PreToolUse hooks. Suggest-only; strict routing off. Fails silent.
- **`setup --research`**: gated, idempotent registration of the advisor on
  PreToolUse (guard `.includes('research-advisor')`).
- **Dashboard**: `/api/research` route + "Research Gateway" panel (routed vs
  bypassed, adoption, cache hit-rate, est tokens saved).
- Observer unchanged: the bypassed-native count derives from existing
  WebFetch/WebSearch events, so no hot-path edit was needed.

### Verification (actually run)
- `pnpm -r build` OK (`dist/hooks/research-advisor.js` emitted); `tsc` core clean.
- Tests: **28 files, 137 passed** (4 new advisor tests).
- Dashboard live on loopback: `GET /api/research` returns the summary JSON; the
  "Research Gateway" panel is present in the served HTML.
- **`setup --research` was NOT executed** (it writes the real
  `~/.claude/settings.local.json`); verified by build + typecheck only, to avoid
  mutating the user's config.

## Slice 2 — expand TTL / stale-cache hardening (DONE)
New `packages/core/src/research/cache.test.ts` (deterministic TTL via `nowMs`:
fresh hit, at-expiry miss, past-TTL miss; stale entry still recoverable via
`getCacheEntry`; evidence dedup by `evidence_id`). Added gateway tests: stale
entry triggers a refetch (TTL lapse → `from_cache:false`, fetcher called twice);
expand still recovers evidence after the entry is stale (no network).
Verification: `tsc` core clean; full suite **29 files, 142 passed**.

## Slice 6 — research benchmark harness (DONE; live numbers pending)

`packages/core/src/research/benchmark.ts` — `runResearchBenchmark(tasks, opts)`
compares two arms over the SAME fetched bytes: **native** (whole raw body counted
as model-visible tokens, what a naive WebFetch ingests) vs **gateway** (ranked,
budget-capped evidence). Per task it reports est model tokens, latency, and a
PROXY `resolved` flag (expected answer present in model-visible text), plus token
reduction. `fetchImpl`/`ghExec` seams let it run on fixtures (offline) or live URLs.

### Verification (actually run)
- `tsc` core clean; full suite **30 files, 143 passed** (1 new benchmark test).
- Fixture run (two synthetic 400-word pages, budget 400, the error in a low-ranked
  `<pre>`): native **1256** est tokens → gateway **177** est tokens =
  **85.9% reduction**, answer preserved in both arms (`resolved:true`).

### Honest limits
- `resolved` is a proxy for answer-presence, NOT live `claude -p` task success.
- Live token/latency/reduction figures were since obtained via the undici
  fallback transport (see the live-network section at the top): 96.6–96.8%
  reduction on a real 415 KB page. Real COST and `claude -p` task-success still
  need the Claude CLI. No live numbers invented.
- Wired to the CLI: `context-pilot benchmark --research --urls <csv> --query <q>
  --expect <s> [--budget <n>]` (fetches the URLs live → needs egress). With no
  `--urls` it prints usage guidance (verified offline). Compute path verified by
  the fixture test and a fixture run (85.9% reduction).
### Live `claude -p` A/B (actually run)
Node 3-task A/B via nested `claude -p --output-format json`, `--allowedTools`
constraining each arm (WebFetch vs contextpilot MCP tools), usage/cost from JSON.
One clean task (node-errors, both arms fetched + correct): native 385,032 in /
$0.240 / 9 turns vs gateway 134,720 in / $0.180 / 3 turns — **−65% input, −25%
cost**. node-fs: gateway thrashed to 13 turns (fetch/expand loop) → worse.
gh-issue: both arms failed (headless `gh` needs permission, WebFetch DNS). Spend
~$2.66/run. Conclusion: per-fetch reduction is real and deterministic, but
end-to-end session tokens hinge on the model's agentic turn count — the gateway
helps in one-shot use, can backfire if the model over-calls `expand` (a skill/
prompting fix, not a tool-reduction failure).

## Post-ship fixes (verified)

- **Dashboard runtime crash** (`RemoveEnvironmentCleanupHook` abort): fixed by
  `better-sqlite3` 11.10.0 → 13.0.3. Dashboard survives sustained DB queries; full
  suite passes on the default vitest pool (no `--pool=forks`).
- **Gateway savings now recorded + shown.** Three bugs fixed:
  1. test cleanups ran an UNSCOPED `DELETE FROM research_ledger WHERE
     tool='contextpilot_fetch'` against the real `~/.context-pilot/telemetry.db`,
     wiping real rows — now scoped per test `url_hash`;
  2. `gateway.ts` stored `url_hash = null` on success so cleanup could not scope —
     now always records `url_hash`;
  3. `getResearchSummary` was latest-session-only — the dashboard now passes
     `sessionId = null` to aggregate across ALL sessions (`contextpilot_research_state`
     stays current-session). Verified live: routed/cache/saved/bypassed/adoption
     populate from `research_ledger` + `events`. Residual `*.test` rows pruned
     (ledger back to 0 absent real usage).

---

# v2 — Covering the Uncovered Gaps (DONE, verified)

Shipped in verify-gated slices; full suite **33 files / 157 tests**, core `tsc` clean, default vitest pool.

- **WS1 — expand/over-call guardrails:** `expand mode:"full"` now windows the body (`offset`/`limit`, ~16k-char cap, `next_offset` paging) so it can't re-dump a page; `fetch`/`research` results carry a `guidance` string steering one-shot use.
- **WS2 — PDF + content-type:** `extract.ts` parses PDFs via `unpdf` (per-page sections), fail-open on bad bytes. Verified live: a real 13 KB PDF → "Dummy PDF file".
- **WS3 — web search:** `contextpilot_search` (new MCP tool) via `search.ts`, SearXNG-first (`CONTEXTPILOT_SEARXNG_URL`) then Brave (`BRAVE_API_KEY`) then native fallback; narrow SSRF allowance for the one configured SearXNG host. Verified live against a local SearXNG (real result URLs, over MCP stdio).
- **WS3b — self-host SearXNG:** `scripts/searxng-up.sh` / `searxng-down.sh` + `scripts/searxng/{docker-compose.yml,settings.example.yml}` (JSON API on, loopback-only, generated secret; runtime `settings.yml` gitignored). Verified: `up.sh` brings SearXNG up and the gateway searches it.
- **WS4 — adoption:** opt-in strict routing — `setup --research --strict` registers `research-router` (PreToolUse deny of native WebFetch/WebSearch, escape `CONTEXTPILOT_ALLOW_NATIVE=1`); hardened skill installed to `~/.claude/skills/research/`. Advisory-only remains the default.
- **WS5 — dashboard + docs:** `/api/research` + panel add a `searched` count; README/OVERVIEW/CLAUDE/mcp README updated (8 tools, `--strict`, PDF, env vars, SearXNG scripts).

Env vars: `CONTEXTPILOT_SEARXNG_URL`, `BRAVE_API_KEY`, `CONTEXTPILOT_ALLOW_NATIVE`.

## Not yet done
Live `claude -p` A/B re-measure with the hardened skill + strict mode (to quantify the adoption change) — costs tokens; run on request. New deps: `unpdf`.
