# ContextPilot

Local-first token-optimization control plane for Claude Code.

## What This Is

ContextPilot orchestrates existing optimization tools (primarily Caveman), provides unified telemetry, detects conflicts between tools, and automates optimization decisions. It does NOT duplicate Caveman's compression or recovery.

## Current State (Phase 5)

Working CLI with 10 commands:
- `contextpilot doctor` — environment inspection (Claude Code, Caveman, hooks, plugins, MCP, conflicts)
- `contextpilot status` — current proxy/optimization state + recent telemetry
- `contextpilot analyze` — token usage analysis from Caveman history + ContextPilot events
- `contextpilot tools` — detected optimization tools, capabilities, conflicts
- `contextpilot report` — comprehensive optimization report
- `contextpilot mode [name]` — show/set operating mode (observe/canary/auto)
- `contextpilot benchmark` — run token optimization benchmarks via `claude -p`
- `contextpilot policies` — evaluate optimization policies against current telemetry
- `contextpilot dashboard` — local web dashboard at http://127.0.0.1:3141
- `contextpilot rollback` — roll back to observe mode

Observer hook script at `packages/cli/dist/hooks/observer.js` records events to `~/.context-pilot/telemetry.db`.

## Architecture

```
packages/
  core/     — detection, adapters, DB, schemas (Zod), paths, policy engine, benchmarks
  cli/      — commander CLI (10 commands), formatters, hooks, dashboard
docs/       — research findings
```

## Commands

```bash
pnpm install                              # install deps
pnpm -r build                             # build all packages
pnpm test                                 # run vitest
node packages/cli/dist/index.js doctor    # run doctor
node packages/cli/dist/index.js status    # run status
node packages/cli/dist/index.js analyze   # run analyze
node packages/cli/dist/index.js tools     # list tools
node packages/cli/dist/index.js report    # full report
node packages/cli/dist/index.js mode      # show mode
node packages/cli/dist/index.js benchmark # run benchmarks
node packages/cli/dist/index.js policies  # evaluate policies
node packages/cli/dist/index.js dashboard # web UI on :3141
node packages/cli/dist/index.js rollback  # reset to observe
```

## Key Constraints

- **Read-only Caveman access** — never modify Caveman's config, DBs, or files
- **No stdout from observer hooks** — Caveman owns hook output
- **Fail open** — if ContextPilot fails, Claude Code works normally
- **No secrets in output** — redact credentials, tokens, API keys
- **Zod passthrough** — all external data schemas use `.passthrough()` for forward compatibility
- **better-sqlite3 native addon** — requires `npm run build-release` in its package dir after install (pnpm blocks build scripts by default)

## Caveman Integration

- Caveman 4.0.1 installed at `~/.caveman/`
- Proxy at `http://127.0.0.1:8787/w/claude` (ANTHROPIC_BASE_URL)
- Hooks on all 10 lifecycle events via user-level `~/.claude/settings.json`
- MCP tools: caveman_compress, caveman_retrieve, caveman_stats
- SQLite DBs: `~/.caveman/caveman.db`, `~/.caveman/ccr.db` (read-only access)
- History: `~/.claude/.caveman-history.jsonl`, `.caveman-mode-log.jsonl`
- Run state: `~/.caveman/run/8787.json`

## Key Research Findings

- Hooks run **in parallel**, not sequentially. Hooks are **additive** across settings levels.
- PostToolUse stdin provides `tool_response` and `duration_ms` — primary telemetry source.
- SessionEnd has 1.5s budget. Observer must be fast.
- Hook output capped at 10,000 chars.
- Prompt cache invalidated by tool definition or system prompt changes.
- Hooks DO run in `claude -p` mode — benchmarks via `-p` will work.

## All Phases Complete

Phases 0-6 implemented. Observer hooks need registration in project `.claude/settings.json` to fire during sessions.

## Testing

Vitest. Tests in `packages/*/src/**/*.test.ts`. Run with `pnpm test`.
