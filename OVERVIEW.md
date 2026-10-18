# ContextPilot

A local-first token-optimization control plane for Claude Code.

## What It Is

ContextPilot is a control plane that sits alongside Claude Code and the optimization tools you already run (primarily [Caveman](https://github.com/)). It does **not** compress prompts or recover dropped context itself — Caveman owns that. Instead, ContextPilot:

- **Orchestrates** existing optimization tools rather than duplicating them.
- **Provides unified telemetry** across hooks, MCP servers, and proxy state.
- **Detects conflicts** between tools (for example, two hooks fighting over the same lifecycle event).
- **Automates optimization decisions** through operating modes and a policy engine.

Everything runs on your machine. If ContextPilot fails, Claude Code keeps working normally — it is designed to *fail open*.

## Why It Exists

Every output token is billed and read, and context management across a long Claude Code session is hard to reason about:

- Files get re-read when they are already in context, silently burning tokens.
- Multiple optimization tools can register hooks on the same lifecycle events and interfere with each other.
- There is no single place to see where tokens are going or whether optimization is actually helping.

ContextPilot gives you one place to inspect, measure, and act on all of that — without taking ownership away from the tools that do the real compression.

## Core Features

### CLI (13 commands)

| Command | What it does |
|---|---|
| `doctor` | Environment inspection — Claude Code, Caveman, hooks, plugins, MCP servers, detected conflicts |
| `status` | Current proxy / optimization state plus recent telemetry |
| `analyze` | Token usage analysis from Caveman history and ContextPilot events |
| `tools` | Detected optimization tools, their capabilities, and conflicts |
| `report` | Comprehensive optimization report |
| `mode [name]` | Show or set the operating mode (`observe` / `canary` / `auto`) |
| `benchmark` | Run token-optimization benchmarks via `claude -p` |
| `policies` | Evaluate optimization policies against current telemetry |
| `dashboard` | Local web dashboard at `http://127.0.0.1:3141` |
| `setup` | Register the MCP server and hooks globally |
| `rollback` | Roll back to `observe` mode |

### MCP Tools (available to Claude after `contextpilot setup`)

- **`contextpilot_budget`** — session token budget summary with policy warnings.
- **`contextpilot_session_files`** — per-file read counts so Claude can avoid re-reading files already in context.
- **`contextpilot_optimize`** — prioritized optimization actions.
- **`contextpilot_fetch`** / **`contextpilot_research`** / **`contextpilot_expand`** / **`contextpilot_research_state`** — the Research Gateway (below).

### Research Gateway

Cuts tokens spent on external research during bug-hunting. Rather than dumping a raw web page, doc, or GitHub thread into context, it fetches, extracts, ranks, token-budgets, and caches the evidence — keeping exact errors/code and version-specific text, with the full source recoverable by `evidence_id`. SSRF-guarded, secret-redacted, fail-open (native `WebFetch`/`WebSearch` remain a fallback). Enable the optional non-blocking advisory with `contextpilot setup --research`.

### Observer Hook

A fast observer hook (`packages/cli/dist/hooks/observer.js`) records lifecycle events to `~/.context-pilot/telemetry.db`. It reads `tool_response` and `duration_ms` from `PostToolUse` stdin — the primary telemetry source — and produces no stdout (Caveman owns hook output).

### Advisor Hooks

- **Prompt advisor** — injects brief optimization hints on `UserPromptExpansion` when a policy triggers.
- **Compact advisor** — injects budget status, including file re-read warnings, on `PostCompact`.

Both are safe: they hook events Caveman does not use.

### Local Dashboard

A web UI on port `3141` for live telemetry, with a Reset button to clear telemetry and start fresh.

## Operating Modes

- **observe** — watch and record only; make no changes.
- **canary** — apply optimizations to a limited slice and compare.
- **auto** — act on policy decisions automatically.

`rollback` always returns you to `observe`.

## Architecture

```
packages/
  core/   — detection, adapters, DB, Zod schemas, paths, policy engine, benchmarks
  cli/    — commander CLI (13 commands), formatters, hooks (observer + advisors), dashboard
  mcp/    — MCP server (budget, session_files, optimize, fetch, research, expand, research_state)
docs/     — research findings
```

## Key Constraints

- **Read-only Caveman access** — never modify Caveman's config, databases, or files.
- **No stdout from observer hooks** — Caveman owns hook output.
- **Fail open** — a ContextPilot failure never breaks Claude Code.
- **No secrets in output** — credentials, tokens, and API keys are redacted.
- **Zod passthrough** — all external-data schemas use `.passthrough()` for forward compatibility.

## Caveman Integration

ContextPilot reads (never writes) Caveman's state:

- Caveman 4.0.1 at `~/.caveman/`, proxy at `http://127.0.0.1:8787/w/claude`.
- Hooks on all 10 lifecycle events via `~/.claude/settings.json`.
- SQLite DBs `~/.caveman/caveman.db` and `~/.caveman/ccr.db` (read-only).
- History at `~/.claude/.caveman-history.jsonl` and `.caveman-mode-log.jsonl`.
- Run state at `~/.caveman/run/8787.json`.

## Getting Started

```bash
pnpm install              # install deps
pnpm -r build             # build all packages
pnpm test                 # run vitest

node packages/cli/dist/index.js doctor     # inspect environment
node packages/cli/dist/index.js setup      # register MCP server + hooks
node packages/cli/dist/index.js dashboard  # open the web UI
```

## Key Research Findings

- Hooks run **in parallel**, not sequentially, and are **additive** across settings levels.
- `PostToolUse` stdin provides `tool_response` and `duration_ms` — the primary telemetry source.
- `SessionEnd` has a ~1.5s budget, so the observer must be fast.
- Hook output is capped at 10,000 characters.
- The prompt cache is invalidated by tool-definition or system-prompt changes.
- Hooks run in `claude -p` mode, so benchmarks via `-p` work.

## Testing

Vitest, with tests in `packages/*/src/**/*.test.ts`. Run `pnpm test`.
