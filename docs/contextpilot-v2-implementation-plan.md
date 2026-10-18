# ContextPilot 2.0 — Implementation Plan

## Context

ContextPilot today is a working local-first Claude Code optimization control plane:
12 CLI commands, 3 MCP tools, observer/advisor hooks, a versioned SQLite telemetry
store, a code-based policy engine, a zero-dependency dashboard, and a single Caveman
adapter. Baseline is healthy — `pnpm -r build` is green and `pnpm test` passes.

The "ContextPilot 2.0" brief evolves it into a six-subsystem intelligence platform
across seven phases. That is a multi-month effort delivered incrementally, one
tested slice at a time, never as a wholesale rewrite. This document is the standing
technical design; the task list lives in `contextpilot-v2-backlog.md` and status in
`contextpilot-v2-progress.md`.

## Scope decisions

- **Lead subsystem:** Telemetry + Cost foundation (Phase 1). Context health,
  dashboard cost, and policy simulation all depend on normalized telemetry + cost.
- **Pricing:** a native **versioned local pricing table** (dated, no network) to
  compute *estimated* cost from `token_snapshots`, plus Caveman's precomputed USD as
  *billed*. Every figure is labelled `estimated | billed`; unknown models resolve to
  unavailable, never 0.
- **Packages:** extend the existing `core`/`cli`/`mcp` packages — new modules under
  `packages/core/src/{cost,telemetry,intelligence,mcp-profile}/`. No new packages
  until a boundary clearly earns one.

## Non-negotiable constraints (every slice)

Local-first · fail-open (ContextPilot failure never breaks Claude Code) · read-only
Caveman · observer writes nothing to stdout · no secrets in output ·
backward-compatible CLI/MCP · Zod `.passthrough()` on external data · forward-only
idempotent migrations · **no invented telemetry** — estimated vs billed vs
unavailable kept explicit, never defaulted to 0.

## What already exists (reuse, do not rebuild)

| Need | Already there |
|---|---|
| Versioned migrations | `packages/core/src/db/connection.ts` `runMigrations` + `_migrations` table — add `004`+ to the ordered array |
| Token aggregation | `db/telemetry-query.ts` `getTokenAggregate`, `getCacheReadRatio`, `estimateContextWindowUsage` |
| Caveman billed USD | `adapters/caveman/stats-reader.ts` — `totalCostUsd`/`savingsUsd`, read-only |
| Model → context limit map | `db/telemetry-query.ts` `MODEL_CONTEXT_LIMITS` (sizes, not prices) |
| CLI report surface | `cli/src/commands/report.ts`, `formatters/table.ts` |
| Mode/config store | `config/mode.ts` `loadConfig`/`saveConfig` (`~/.context-pilot/config.json`) |
| Public API barrel | `packages/core/src/index.ts` |

Gaps the brief targets: no cost model (now closing in P0-1); `events` has no dedup
key / provenance / confidence; no observed-vs-estimated-vs-billed distinction;
policies are imperative (no declarative schema, simulation, or history); no MCP
profiling; only the Caveman adapter; dashboard is one inline HTML string with one
unauthenticated state-changing endpoint (`POST /api/reset`).

## Module boundaries

```
packages/core/src/
  cost/          cost + pricing  (P0-1, done)
    pricing.ts   versioned table + getModelPricing
    estimate.ts  pure estimateCost
    index.ts     getSessionCost (estimate + Caveman billed)
  telemetry/     normalized event provenance + dedup (P0-2/P0-3)
  intelligence/  file-read intelligence + context health (P1-1/P1-2)
  mcp-profile/   MCP server/tool profiling (P1-4)
  policy/        declarative schema alongside code policies (P2-1/P2-2)
```

## Data models

- **Pricing** (`cost/pricing.ts`): `PricingTable { version, asOf, currency, source,
  models }`; `ModelPricing { inputPerMTok, outputPerMTok, cacheReadPerMTok?,
  cacheWritePerMTok? }`. Optional rates omitted when not confidently known.
- **Estimate** (`cost/estimate.ts`): `CostEstimate { usd, breakdown, unpriced,
  partial, modelId, pricingVersion, kind:'estimated' }`. `estimateCost` is pure;
  unknown model → `null`; unpriced non-zero token kinds set `partial` instead of
  inflating or zeroing the figure.
- **Session cost** (`cost/index.ts`): `SessionCost { sessionId, model, estimated,
  billed }`; billed read from Caveman session stats by matching session id.

## Database migrations (planned)

The migration framework is name-based, idempotent, forward-only, SQL applied inside
`runMigrations`. Planned additions (not in P0-1, which needs no migration):

- `004-event-provenance`: `ALTER TABLE events ADD COLUMN event_id TEXT`, `source
  TEXT`, `confidence REAL`; partial unique index on `event_id`; observer uses
  `INSERT OR IGNORE` with a deterministic id for dedup.
- `005-token-kind`: `ALTER TABLE token_snapshots ADD COLUMN usage_kind TEXT`
  (observed | estimated | billed); aggregation never mixes kinds.

All additive `ADD COLUMN` — safe on existing DBs, fail-open preserved.

## CLI changes

- `report`: cost section (done in P0-1) — estimated (latest session) + billed
  (Caveman), both labelled; `--json` gains a `cost` object.
- `analyze`, `status`: cost surfaced (P0-4).
- `mcp list|profile|inspect|conflicts`: new subcommand group (P1-4), matching the
  existing `program.command(...)` wiring in `cli/src/index.ts`.
- `policies simulate|explain|history|validate` (P2-2).

## MCP changes

- `contextpilot_budget`: add session cost (estimated/billed) (P0-4).
- No new tools until a profiling surface earns one.

## Dashboard architecture

Keep the zero-dependency `node:http` + inline-HTML stack. Add views incrementally
(Session Explorer, Context Intelligence, MCP Profiler, Policy Center, Benchmark
Center, Diagnostics). Harden the one state-changing endpoint (`POST /api/reset`)
with a localhost-origin check before adding more (P2-3).

## Test strategy

- Pure modules (cost estimate, health scoring) → deterministic unit tests, no DB.
- DB modules → tests against a temp SQLite file (pattern already in
  `db/file-reads.test.ts`).
- Fail-injection suite (P2-6): DB lock, corrupt telemetry, missing Caveman/MCP,
  observer exception, bad hook payload — asserting Claude Code keeps working.

## Security considerations

Read-only Caveman access only. No secrets in telemetry or output. Dashboard bound to
`127.0.0.1`; state-changing endpoints origin-checked. Content fingerprints hash
path + mtime + size, never raw file content.

## Performance implications

Observer stays off any new heavy path (cost is computed in read commands, not in the
hook). Hooks keep their budgets (observer < 5s, advisors < 3s).
