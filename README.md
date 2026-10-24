# ContextPilot

[![CI](https://github.com/MohammedElattar/context-pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/MohammedElattar/context-pilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

Local-first token-optimization control plane for Claude Code.

ContextPilot orchestrates existing optimization tools (primarily [Caveman](https://caveman.so)), provides unified telemetry, detects conflicts between tools, and automates optimization decisions. It does not duplicate Caveman's compression or recovery — it sits on top and makes them smarter.

## What You Get

| Feature | Description |
|---------|-------------|
| **Caveman integration** | Reads Caveman DB for input optimization stats, compression ratios, cache intelligence, waste findings, and per-model pricing |
| **Token snapshots** | Observer hook populates real-time token usage from Caveman request data |
| **Output conciseness** | Prompt advisor injects brevity directives; reread-guard warns when session output is high |
| **Policy engine** | Triggers on high output, high context, repeated file reads, low cache ratio |
| **Research gateway** | SSRF-safe fetch, Readability extraction, focused ranking, token budget, SQLite cache |
| **Free local search** | SearXNG via Docker — no API key needed |
| **Web dashboard** | Real-time panels for session stats, research gateway, token usage |
| **30+ Caveman skills** | Full skill suite for compression, review, optimization, exploration, commits |

## Prerequisites

- **Node.js** >= 20 — auto-installed via nvm if missing
- **pnpm** 10 — auto-installed via corepack/npm
- **Claude Code** — the CLI this tool observes and optimizes
- **Caveman** — token optimization proxy; auto-installed via `npm -g @caveman-ai/cli` if missing
- **GitHub CLI (`gh`)** — for research gateway GitHub provider; auto-installed if missing
- **Docker** (optional) — needed for free local SearXNG search

## Quick Start

One command installs **everything**: Node, pnpm, Caveman, gh, dependencies, builds all packages, registers MCP server + hooks + research skill, and starts SearXNG if Docker is present.

```bash
git clone https://github.com/MohammedElattar/context-pilot.git
cd context-pilot
./scripts/install.sh
```

Then **restart Claude Code** and verify:

```bash
contextpilot doctor     # or: node packages/cli/dist/index.js doctor
```

### Installer Options

```bash
./scripts/install.sh                 # everything (default)
./scripts/install.sh --strict        # deny native WebFetch/WebSearch (force gateway)
./scripts/install.sh --no-searxng    # skip local SearXNG
./scripts/install.sh --no-setup      # install + build only; don't touch ~/.claude
./scripts/install.sh --no-research   # setup without the research advisory/skill
./scripts/install.sh --no-caveman    # skip Caveman install
./scripts/install.sh --no-docker     # skip Docker check and SearXNG
./scripts/install.sh --no-gh         # skip GitHub CLI install
./scripts/install.sh --no-node-install   # fail if Node < 20 missing
./scripts/install.sh --test          # also run the test suite
./scripts/install.sh --help
```

The installer covers 8 steps:
1. **Node >= 20** via nvm (user-space, no sudo)
2. **pnpm** via corepack or npm
3. **Caveman** via `npm -g @caveman-ai/cli` (checks proxy + login status)
4. **GitHub CLI** auto-install (apt/brew/dnf/pacman)
5. **Docker** detection with install guidance
6. **ContextPilot** deps + build
7. **SearXNG** free local search via Docker
8. **Setup** — MCP server, hooks, research skill in `~/.claude`

> The script is idempotent — safe to re-run. It prints a summary table and next steps at the end.

### Manual Install (alternative)

```bash
pnpm install && pnpm -r build
node packages/cli/dist/index.js setup --research   # register globally
# optional: make the `contextpilot` command global
cd packages/cli && pnpm link --global && cd ../..
```

### Post-Install: Start Caveman

```bash
caveman login            # free account (enables learn/cloud features)
caveman claude           # start the optimization proxy
```

This sets `ANTHROPIC_BASE_URL=http://127.0.0.1:8787/w/claude` so all Claude requests flow through Caveman's compression layer.

### Troubleshooting

- **`better-sqlite3` fails to load** — rebuild the native addon:
  ```bash
  cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run build-release
  ```
- **`contextpilot` command not found** — use `node packages/cli/dist/index.js` or run `cd packages/cli && pnpm link --global`
- **Hooks or MCP tools not active** — restart Claude Code after setup; confirm with `contextpilot doctor`
- **Caveman proxy not running** — run `caveman claude` to start it
- **SearXNG not working** — check Docker is running, then `./scripts/searxng-up.sh`

## Commands

| Command | Description |
|---------|-------------|
| `contextpilot doctor` | Inspect environment, Claude Code, Caveman, hooks, conflicts |
| `contextpilot status` | Current optimization state and recent telemetry |
| `contextpilot analyze` | Token usage analysis from telemetry history |
| `contextpilot tools` | Detected optimization tools, capabilities, conflicts |
| `contextpilot report` | Comprehensive optimization report |
| `contextpilot mode [name]` | Show or set operating mode (`observe`, `canary`, `auto`) |
| `contextpilot benchmark` | Run token optimization benchmarks via `claude -p` |
| `contextpilot policies` | Evaluate optimization policies against current telemetry |
| `contextpilot dashboard` | Local web dashboard at `http://127.0.0.1:3141` |
| `contextpilot setup` | Register MCP server and hooks globally |
| `contextpilot rollback` | Roll back to observe mode |
| `contextpilot recover <handle>` | Recover compressed content via Caveman MCP |

All commands support `--json` for machine-readable output.

## Operating Modes

- **observe** — Collect telemetry only. No active optimization. Default.
- **canary** — Report and suggest optimizations when policies trigger.
- **auto** — Report and apply safe optimizations automatically.

Set mode: `contextpilot mode auto`

## MCP Tools

After `contextpilot setup`, these tools are available to Claude during sessions:

| Tool | Description |
|------|-------------|
| `contextpilot_budget` | Session token budget summary with policy warnings |
| `contextpilot_session_files` | Per-file read counts to avoid re-reads |
| `contextpilot_optimize` | Prioritized optimization actions + Caveman waste findings |
| `contextpilot_hunt_health` | Hunt health diagnostics |
| `contextpilot_search` | Web search → ranked URLs + snippets (SearXNG / Brave / native) |
| `contextpilot_fetch` | Fetch one URL as ranked, budget-capped, cached evidence |
| `contextpilot_research` | Research across URLs + GitHub issues/PRs, merged/ranked/budgeted |
| `contextpilot_expand` | Recover omitted sections by `evidence_id` from cache |
| `contextpilot_research_state` | Gateway adoption, cache hit-rate, tokens saved |

## Caveman Integration

ContextPilot fully integrates with [Caveman](https://caveman.so) for token optimization:

| Component | What It Does |
|-----------|-------------|
| **Proxy** | Routes Claude requests through `http://127.0.0.1:8787/w/claude` for input compression |
| **Stats reader** | Reads `~/.caveman/caveman.db` for optimization stats, compression ratios, cache intelligence |
| **Learn sinks** | Surfaces Caveman's waste findings (reducible token sinks) in `contextpilot_optimize` |
| **Pricing** | Uses Caveman's per-model pricing catalog for accurate cost estimates |
| **Hooks** | Caveman hooks on all 10 lifecycle events; ContextPilot hooks complement (never conflict) |
| **MCP tools** | `caveman_compress`, `caveman_retrieve`, `caveman_stats`, `caveman_toon_encode`, `caveman_toon_decode` |

### Caveman Skills (installed with Caveman)

| Skill | Description |
|-------|-------------|
| `caveman` | Terse caveman voice — answer first, fluff gone |
| `caveman-commit` | Conventional Commits compressed to intent only |
| `caveman-compress` | Compress memory files (CLAUDE.md, todos) to save tokens |
| `caveman-discover` | Find and label LLM workflows for spend grouping |
| `caveman-evidence-review` | Review Caveman Cloud evidence: cost, score, workflows |
| `caveman-explore` | Read-only repo explorer for cold-start orientation |
| `caveman-help` | Quick-reference for caveman skills and commands |
| `caveman-learn` | Act on learn report — apply cost-lowering fixes |
| `caveman-manage` | Inspect/manage Caveman Cloud experiments |
| `caveman-optimize` | Turn optimization observations into evaluated candidates |
| `caveman-review` | Compressed code review — one line per finding |
| `caveman-setup` | Wire a repo through Caveman Cloud gateway |
| `caveman-stats` | Show session token usage and mode attribution |
| `cavecrew` | Delegate to investigator/builder/reviewer subagents |
| `find-skills` | Discover and install additional agent skills |

### ContextPilot Skills

| Skill | Description |
|-------|-------------|
| `research` | Research gateway usage skill (auto-installed by setup) |
| `hunt` | Bug hunting with evidence-ranked hypotheses |
| `report` | Comprehensive optimization reporting |
| `triage` | Issue triage and prioritization |

## Hooks

ContextPilot registers these hooks in `~/.claude/settings.local.json`:

| Hook | Event | Purpose |
|------|-------|---------|
| Observer | SessionStart, PostToolUse, PostToolUseFailure, PreCompact, Stop, SessionEnd | Records events + token snapshots to telemetry DB |
| Prompt advisor | UserPromptExpansion | Always injects conciseness directive; adds policy advice when triggered |
| Compact advisor | PostCompact | Injects budget status after context compaction |
| Research router | PreToolUse | Steers WebFetch/WebSearch to gateway (advisory or strict) |
| Reread guard | PreToolUse | Warns on file re-reads; advises brevity when output >50K tokens |
| Research advisor | PreToolUse | Suggests gateway tools for research-shaped requests |

These complement Caveman's hooks (registered in `~/.claude/settings.json`) — no conflicts.

## Research Gateway

Reduces tokens spent on external research. Instead of pulling raw web pages into context, the gateway fetches, extracts, ranks, budgets, and caches evidence — preserving exact error strings, stack traces, and version-specific text.

- **SSRF-safe**: private/metadata/rebinding/redirect guards
- **PDF support**: via `unpdf` extraction
- **Caching**: SQLite with TTL + content-hash dedup
- **GitHub**: issues/PRs via `gh` CLI or API
- **Search**: SearXNG (free, local) → Brave (free API key) → native WebSearch
- **Fail-open**: native tools stay as fallback

### Free Local Search (SearXNG)

```bash
./scripts/searxng-up.sh      # start on 127.0.0.1:8080
./scripts/searxng-down.sh    # stop
```

Or set `BRAVE_API_KEY` (free tier) for Brave search. With neither, falls back to native `WebSearch`.

## Architecture

```
packages/
  core/     — Detection, adapters, DB, schemas (Zod), paths, policy engine, research gateway
  cli/      — Commander CLI (13 commands), formatters, hooks, dashboard, statusline
  mcp/      — MCP server (9 tools)
scripts/
  install.sh         — full-stack turnkey installer
  searxng-up.sh      — start local SearXNG
  searxng-down.sh    — stop local SearXNG
```

- **Monorepo** managed with pnpm workspaces
- **Build**: tsup (esbuild) — ESM only
- **DB**: SQLite via better-sqlite3 at `~/.context-pilot/telemetry.db` (WAL mode)
- **Test**: Vitest (161 tests)

## Development

```bash
pnpm install          # Install deps
pnpm -r build         # Build all packages
pnpm test             # Run tests
pnpm test -- --watch  # Watch mode
```

## Key Constraints

- **Read-only Caveman access** — never modifies Caveman's config, DBs, or files
- **No stdout from observer hooks** — Caveman owns hook output on standard events
- **Fail open** — if ContextPilot fails, Claude Code works normally
- **No secrets in output** — credentials and tokens are redacted
- **Hooks are additive** — ContextPilot hooks complement Caveman's, never conflict

## License

[MIT](./LICENSE)
