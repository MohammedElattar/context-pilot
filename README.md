# ContextPilot

[![CI](https://github.com/MohammedElattar/context-pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/MohammedElattar/context-pilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

Local-first token-optimization control plane for Claude Code.

ContextPilot orchestrates existing optimization tools (primarily [Caveman](https://caveman.so)), provides unified telemetry, detects conflicts between tools, and automates optimization decisions. It does not duplicate Caveman's compression or recovery — it sits on top and makes them smarter.

## Prerequisites

- **Node.js** >= 20 — the installer auto-installs it via nvm (user-space) if missing
- **pnpm** 10 — the installer enables it via corepack (npm-global fallback)
- **Claude Code** — the CLI this tool observes and optimizes
- **Caveman** (optional) — ContextPilot detects and integrates with it if installed, and works standalone if not
- **`gh`** (optional) — the research gateway uses it for GitHub issues/PRs; it falls back to the public API without it

## Quick Start

Clone and run the one-command installer. It does **everything**: installs prerequisites (Node via nvm if missing, pnpm via corepack), installs dependencies, builds every package, registers the MCP server + hooks + research skill in `~/.claude`, and — if Docker is present — starts a free local SearXNG and persists `CONTEXTPILOT_SEARXNG_URL` to your shell profile so `contextpilot_search` works out of the box.

```bash
git clone https://github.com/MohammedElattar/context-pilot.git
cd context-pilot
./scripts/install.sh
```

Then **restart Claude Code** and verify with `node packages/cli/dist/index.js doctor`.

Installer options:

```bash
./scripts/install.sh                 # everything (default)
./scripts/install.sh --strict        # also deny native WebFetch/WebSearch (force gateway routing)
./scripts/install.sh --no-searxng    # skip local SearXNG (search falls back to native)
./scripts/install.sh --no-setup      # install + build only; don't touch ~/.claude
./scripts/install.sh --no-research   # register setup without the research advisory/skill
./scripts/install.sh --no-node-install   # fail instead of auto-installing Node
./scripts/install.sh --test          # also run the test suite
./scripts/install.sh --help
```

> `setup` writes `~/.claude.json` and `~/.claude/settings.local.json` (how Claude Code discovers the tool). Use `--no-setup` to skip it. The script is idempotent — safe to re-run.

### Manual install (alternative)

```bash
pnpm install && pnpm -r build
node packages/cli/dist/index.js setup --research   # register globally
# optional: make the `contextpilot` command global
cd packages/cli && pnpm link --global && cd ../..
```

> Without the global link, run commands as `node packages/cli/dist/index.js <command>` instead of `contextpilot <command>`.

### Troubleshooting

- **`better-sqlite3` fails to load** — it ships a native addon. pnpm builds it automatically (allow-listed in `pnpm.onlyBuiltDependencies`). If it still fails, rebuild it:
  ```bash
  cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run build-release
  ```
- **`contextpilot` command not found** — re-run step 4, or use the full `node packages/cli/dist/index.js` path.
- **Hooks or MCP tools not active** — restart Claude Code after `contextpilot setup`; confirm with `contextpilot doctor`.

## Commands

| Command | Description |
|---------|-------------|
| `contextpilot doctor` | Inspect environment, Claude Code, Caveman, hooks, conflicts |
| `contextpilot status` | Current optimization state and recent telemetry |
| `contextpilot analyze` | Token usage analysis from telemetry history |
| `contextpilot tools` | Detected optimization tools, capabilities, conflicts |
| `contextpilot report` | Comprehensive optimization report |
| `contextpilot mode [name]` | Show or set operating mode (`observe`, `canary`, `auto`) |
| `contextpilot benchmark` | Run token optimization benchmarks via `claude -p` (add `--research --urls <csv> --query <q> --expect <s>` for the research-gateway A/B) |
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

After running `contextpilot setup`, these tools are available to Claude during sessions:

- **`contextpilot_budget`** — Session token budget summary with policy warnings
- **`contextpilot_session_files`** — Per-file read counts to avoid re-reads
- **`contextpilot_optimize`** — Prioritized optimization actions

### Research Gateway

Reduces tokens spent on external research during bug-hunting. Instead of pulling a raw web page, doc, or GitHub thread into context, these tools fetch, extract, rank, token-budget, and cache the evidence — preserving exact error strings, stack traces, and version-specific text — and keep the full source recoverable. SSRF-guarded (private/metadata/rebinding/redirect blocks), secret-redacted, fail-open (native `WebFetch`/`WebSearch` stay as fallback).

- **`contextpilot_search`** — Open-web search → ranked result URLs + snippets (free SearXNG or Brave; falls back to native WebSearch). Feed the URLs to `contextpilot_research`.
- **`contextpilot_fetch`** — Fetch one URL (web page, doc, or **PDF**); returns ranked, budget-capped evidence with stable `evidence_id`s; cache-first.
- **`contextpilot_research`** — Research a question across several URLs (web/docs and GitHub issues/PRs via `gh`) in one call; merged, ranked, budgeted with per-source provenance.
- **`contextpilot_expand`** — Recover an omitted section (or the full page, paged) by `evidence_id`, from cache, no network.
- **`contextpilot_research_state`** — Routing adoption (gateway vs native), cache hit-rate, estimated tokens saved; shown on the dashboard's Research Gateway panel.

Adoption: `contextpilot setup --research` registers a non-blocking PreToolUse hint toward these tools (never blocks). `contextpilot setup --research --strict` additionally **denies** native `WebFetch`/`WebSearch` so Claude routes through the gateway (escape with `CONTEXTPILOT_ALLOW_NATIVE=1`). A usage skill installs to `~/.claude/skills/research/`. See [`docs/research-gateway-plan.md`](docs/research-gateway-plan.md).

### Free local search (SearXNG)

`./scripts/install.sh` already starts SearXNG and persists `CONTEXTPILOT_SEARXNG_URL` when Docker is present — nothing else to do. To manage it standalone:

```bash
./scripts/searxng-up.sh      # start SearXNG on 127.0.0.1:8080 (JSON API on) + print the env var
./scripts/searxng-down.sh    # stop it
```

Alternatively set `BRAVE_API_KEY` (free tier) to use Brave. With neither set, `contextpilot_search` returns a note to use native `WebSearch`.

## Architecture

```
packages/
  core/     — Detection, adapters, DB, schemas (Zod), paths, policy engine, benchmarks, research gateway
  cli/      — Commander CLI (13 commands), formatters, hooks (observer + advisors incl. research), dashboard
  mcp/      — MCP server (8 tools)
scripts/
  install.sh — turnkey installer (prerequisites + build + setup)
  searxng-up.sh / searxng-down.sh — free local SearXNG for contextpilot_search
skills/
  research/  — concise research-gateway usage skill
```

- **Monorepo** managed with pnpm workspaces
- **Build**: tsup (esbuild) — ESM only
- **DB**: SQLite via better-sqlite3 at `~/.context-pilot/telemetry.db` (WAL mode)
- **Test**: Vitest

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

## License

[MIT](./LICENSE)
