# ContextPilot 2.0 — Progress

_Updated: 2026-10-17_

## Completed

- **Repository audit** — architecture mapped (core/cli/mcp), baseline established:
  `pnpm -r build` green, `pnpm test` 50/50 across 11 files before v2 work.
- **Tracking docs** — `contextpilot-v2-implementation-plan.md`,
  `contextpilot-v2-backlog.md`, this file.
- **P0-1 Cost & Pricing module** — `core/src/cost/{pricing,estimate,index}.ts`,
  exports in `core/src/index.ts`, cost section in `cli report`, new tests
  `cost/estimate.test.ts`. Estimated (local versioned pricing) + billed (Caveman),
  labelled; unknown model → unavailable; unpriced token kinds → `partial`, never 0.

- **P0-2 Event provenance + dedup** — migration `004` + idempotent `ensureColumn`
  (`core/src/db/connection.ts`) add `event_id`/`source`/`confidence` to `events` and
  a partial unique index on `event_id`. `insertEvent` now `INSERT OR IGNORE`s on that
  key; observer stamps `event_id = <hook>:<tool_use_id>` (when present),
  `source='observer'`, `confidence=1`. Tests `db/event-provenance.test.ts`. Column
  adds done in code (not raw `ALTER`) so they stay idempotent under the parallel test
  DB and partial prior runs.

- **P0-3 Usage-kind on token_snapshots** — migration `005` + `ensureColumn` add
  `usage_kind` (observed|estimated|billed, default observed) and index; idempotent
  backfill maps Caveman source→billed else observed. `getTokenAggregate(sinceMs,
  kind='observed')` never mixes kinds (`kind=null` sums all); cost query reads
  observed only. Tests `db/token-kind.test.ts`.
- **P0-4 Cost surfaced everywhere** — MCP `contextpilot_budget` (`cost.estimated` +
  `cost.billed`), `cli status`, `cli analyze`, dashboard `/api/overview`. Each shows
  estimated + billed, labelled, "unavailable" when absent. No schema change.

- **P1-1 File-read intelligence** — `file_reads` gains `is_partial` + `fingerprint`
  (hash of path+mtime+size, never content). `intelligence/file-reads.ts`
  `analyzeFileReads`: unchanged-repeat detection, partial-vs-full, compaction-aware
  confidence (0.9 → 0.5 across a `PreCompact` boundary). Tests present.
- **P1-2 Context Health Score** — `intelligence/health.ts` `computeContextHealth`:
  7 weighted factors each with status+detail; score over known factors only,
  `confidence` + `missing_data` reported, empty session → null not 0. Tests present.
- **P1-3 Recommendations surface** — MCP `contextpilot_optimize` returns
  `context_health` + evidence `read_recommendations`; `cli report` Context Health
  section (live: 81/100 on dev telemetry).
- **P1-4 MCP profiler** — `mcp-profile/profile.ts` + `cli mcp
  list|profile|inspect|conflicts`; calls/error-rate/latency/bytes/unused, optional
  session scope. Tests present.

- **P2-1 Declarative policy schema** — `policy/declarative.ts`: Zod
  `DeclarativePolicySchema` (metric/operator/value/severity/actionType/action/
  confidence/priority), `compileDeclarativePolicy` → same `Policy` interface as code
  policies, `loadDeclarativePolicies` (fail-open from `~/.context-pilot/policies.json`),
  `validateDeclarativePolicies`. `evaluateAllPolicies` merges code + declarative.
  `PolicyResult` gained optional `confidence`/`priority`. Tests present.
- **P2-2 Policy simulate/explain/validate** — `cli policies [action] [id]`:
  evaluate (now includes declarative) | validate (checks the policy file, dup ids,
  shapes) | explain <id> (definition + current evaluation) | simulate (dry-run across
  recent sessions, no writes). Also fixed a pre-existing `printSection` crash (called
  with no checks array). Persistent evaluation-history/audit table still pending.
- **P2-3 Dashboard reset hardening** — `POST /api/reset` now requires a loopback,
  same-origin request (`isLoopbackRequest`), returns 403 otherwise; removed the
  wildcard `Access-Control-Allow-Origin: *` so telemetry isn't cross-origin readable.
  Verified 200 same-origin / 403 cross-origin / 200 GET. Full Dashboard 2.0 views
  still pending.

- **P2-6 Failure-injection suite** — `core/src/reliability.test.ts`: proves
  fail-open for unknown sessions, unknown models, missing/corrupt policy files,
  garbage validation input, unavailable metrics, and a corrupt SQLite file through
  the read-only wrapper pattern. 10 assertions, all pass.
- **P2-4 Generic agent adapter** — `adapters/agent.ts`: `AgentAdapter` interface +
  `AgentCapability` discovery + `detectAgents()`. `ClaudeCodeAgentAdapter` is the one
  validated PoC (capabilities discovered from wired hooks/telemetry, not assumed);
  other agents intentionally absent until their APIs are validated. Tests present.
- **P2-5 Extension SDK** — design doc `docs/contextpilot-v2-sdk-design.md`
  (versioned plugin contract, permission model, error-isolation wrapper, extension
  points, lifecycle). No code shipped on purpose — an SDK with no plugin is
  speculative scaffolding; code follows the first real consumer.
- **P2-6 Benchmark persistence** — migration `006` `benchmark_runs` +
  `benchmark/store.ts` (`storeBenchmarkReport`, `getRecentBenchmarks`); `cli
  benchmark` persists summaries (fail-open) for baseline comparison. Tests present.

## In progress

- (none — stopped; see remaining)

## Remaining (not yet done)
- P2-2: persistent policy evaluation history / audit trail (CLI `policies history`).
- P2-3: full Dashboard 2.0 views (Session Explorer, Context Intelligence panel, MCP
  Profiler panel, Policy Center, Benchmark Center, Diagnostics). Reset endpoint is
  already hardened; cost is already on `/api/overview`.
- P2-4: a second validated agent adapter (Codex/Gemini/OpenCode) once their real
  hook/telemetry APIs are confirmed.
- P2-5: SDK implementation (follows first real plugin consumer, per design doc).
- Benchmark Center / cost-per-task reporting on top of `benchmark_runs`.

## Blockers

- None.

## Architectural decisions

- Extend existing packages; no new packages until a boundary earns one.
- Native versioned pricing table (local, no network) + Caveman billed USD; honesty
  over coverage — a rate that is not confidently known is omitted, so the figure
  reads as `partial` / `unavailable` rather than being guessed.
- Cost computed in read commands, not in the observer hook — keeps the hot path and
  its budget untouched.

## Validation results

- P0-1: see "Completed". Build + full test run recorded in the session; cost
  section renders "unavailable" cleanly on an empty telemetry DB and never throws.
