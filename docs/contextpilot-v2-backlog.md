# ContextPilot 2.0 — Prioritized Backlog

Priorities: **P0** (foundation, blocks others) · **P1** (high value) · **P2** (later).
Each task lists goal, files, dependencies, acceptance, tests, risk, complexity.

---

## P0 — Telemetry + cost foundation

### P0-1 Cost & Pricing module — DONE
- **Goal:** native estimated cost from recorded tokens + Caveman billed USD, labelled.
- **Files:** `core/src/cost/{pricing,estimate,index}.ts`, `cost/estimate.test.ts`,
  `core/src/index.ts` (exports), `cli/src/commands/report.ts` (cost section).
- **Dependencies:** none (reads existing `token_snapshots`; no migration).
- **Acceptance:** `estimateCost` returns correct USD for a priced model, `null` for
  an unpriced one; unpriced token kinds set `partial`, not 0; `report` shows a
  labelled cost line that reads "unavailable" with no data; build + tests green;
  observer and Caveman untouched.
- **Tests:** `cost/estimate.test.ts` (known model, cache-read, partial, unknown→null,
  zero-tokens, sum, dated-id match, negative clamp).
- **Risk:** low — additive, pure, off hot path.
- **Complexity:** S.

### P0-2 Event provenance + dedup
- **Goal:** dedup duplicate events; record source + confidence.
- **Files:** `core/src/db/connection.ts` (migration `004`), `db/telemetry-store.ts`,
  `cli/src/hooks/observer.ts`.
- **Dependencies:** none.
- **Acceptance:** re-delivered identical event inserts once (`INSERT OR IGNORE` on a
  deterministic `event_id`); existing rows unaffected; observer still silent + <5s.
- **Tests:** dedup insert, provenance columns, migration idempotency.
- **Risk:** medium — touches observer hot path; keep it minimal and fail-open.
- **Complexity:** M.

### P0-3 Usage-kind on token_snapshots
- **Goal:** explicit observed / estimated / billed distinction; never double-count.
- **Files:** migration `005`, `db/telemetry-store.ts`, `db/telemetry-query.ts`.
- **Dependencies:** P0-1 (estimated kind), P0-2 (pattern).
- **Acceptance:** aggregation filters by kind; backfill maps `source`→kind; queries
  never sum across kinds.
- **Tests:** per-kind aggregate, backfill, no cross-kind double count.
- **Risk:** medium. **Complexity:** M.

### P0-4 Cost surfaced everywhere
- **Goal:** cost in `analyze`, `status`, dashboard `/api/overview`, MCP `budget`.
- **Files:** `cli/src/commands/{analyze,status}.ts`, `cli/src/commands/dashboard.ts`,
  `mcp/src/tools/budget.ts`.
- **Dependencies:** P0-1.
- **Acceptance:** each surface shows estimated + billed, labelled, "unavailable" when
  absent; no schema change.
- **Tests:** budget tool returns cost fields; snapshot of formatter output.
- **Risk:** low. **Complexity:** S.

---

## P1 — Context + MCP intelligence

### P1-1 File-read intelligence
- **Goal:** full-vs-partial reads, content fingerprint (hash of path+mtime+size,
  never raw content), compaction-boundary awareness (confidence drops after
  `PreCompact`).
- **Files:** migration (file_reads columns), `observer.ts`, new
  `core/src/intelligence/file-reads.ts`.
- **Dependencies:** P0-2.
- **Acceptance:** repeated unchanged read flagged with confidence; a read after
  compaction is not assumed still-in-context.
- **Risk:** medium. **Complexity:** M.

### P1-2 Context Health Score
- **Goal:** explainable score from context pressure, redundant reads, cache
  efficiency, tool-call redundancy, compaction frequency, retry rate, telemetry
  completeness — with contributing factors + missing-data indicators.
- **Files:** `core/src/intelligence/health.ts`, CLI + MCP surfaces.
- **Dependencies:** P0-3, P1-1.
- **Risk:** low (pure scoring). **Complexity:** M.

### P1-3 Recommendations surface
- **Goal:** evidence-backed recommendations in CLI + MCP `optimize`.
- **Dependencies:** P1-1, P1-2. **Risk:** low. **Complexity:** S.

### P1-4 MCP profiler
- **Goal:** invocation counts, latency, error/timeout, response sizes, duplicate
  responses, unused tools, tool-definition overhead — from `events` where
  `tool_name` is MCP-prefixed.
- **Files:** `core/src/mcp-profile/`, `cli/src/commands/mcp.ts`
  (`list|profile|inspect|conflicts`), `cli/src/index.ts`.
- **Dependencies:** P0-2. **Risk:** low. **Complexity:** M.

---

## P2 — Policy, dashboard, adapters, SDK

### P2-1 Declarative policy schema
- **Goal:** Zod declarative policies (conditions/operators/thresholds/windows/
  priority/confidence) alongside the 5 code policies, backward-compatible.
- **Files:** `core/src/policy/schema.ts`, `policy/engine.ts`. **Complexity:** M.

### P2-2 Policy simulation + history
- **Goal:** `policies simulate|explain|history|validate`; evaluation history table;
  dry-run; canary comparison; audit trail; reversible capability-gated actions.
- **Dependencies:** P2-1. **Complexity:** L.

### P2-3 Dashboard 2.0
- **Goal:** Session Explorer, Context Intelligence, MCP Profiler, Policy Center,
  Benchmark Center, Diagnostics; harden `POST /api/reset` (localhost origin check).
- **Complexity:** L.

### P2-4 Generic agent adapter
- **Goal:** adapter interface + capability discovery extending `OptimizerAdapter`;
  one validated PoC adapter only after confirming real APIs. **Complexity:** L.

### P2-5 Extension SDK
- **Goal:** versioned plugin interfaces, permissions, error isolation, diagnostics;
  design doc first. **Complexity:** L.

### P2-6 Benchmark persistence + failure injection
- **Goal:** persist `BenchmarkReport` to SQLite; failure-injection tests (DB lock,
  corrupt telemetry, missing Caveman/MCP, observer exception, bad hook payload)
  proving Claude Code keeps working. **Complexity:** M.
