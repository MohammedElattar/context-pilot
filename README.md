# ContextPilot

[![CI](https://github.com/MohammedElattar/context-pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/MohammedElattar/context-pilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

Local-first token-optimization control plane for Claude Code.

ContextPilot orchestrates existing optimization tools (primarily [Caveman](https://caveman.so)), provides unified telemetry, detects conflicts between tools, and automates optimization decisions. It does not duplicate Caveman's compression or recovery — it sits on top and makes them smarter.

## Prerequisites

- **Node.js** >= 20
- **pnpm** 10 (`npm install -g pnpm@10`)
- **Claude Code** — the CLI this tool observes and optimizes
- **Caveman** (optional) — ContextPilot detects and integrates with it if installed, and works standalone if not

## Quick Start

```bash
# 1. Clone
git clone https://github.com/MohammedElattar/context-pilot.git
cd context-pilot

# 2. Install dependencies
pnpm install

# 3. Build all packages
pnpm -r build

# 4. (Optional) Make the `contextpilot` command available everywhere
cd packages/cli && pnpm link --global && cd ../..

# 5. Register hooks and the MCP server globally
contextpilot setup          # or: node packages/cli/dist/index.js setup

# 6. Restart Claude Code for the hooks and MCP tools to take effect
```

Verify the install with `contextpilot doctor`.

> If you skip step 4, run commands with `node packages/cli/dist/index.js <command>` instead of `contextpilot <command>`.

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

After running `contextpilot setup`, these tools are available to Claude during sessions:

- **`contextpilot_budget`** — Session token budget summary with policy warnings
- **`contextpilot_session_files`** — Per-file read counts to avoid re-reads
- **`contextpilot_optimize`** — Prioritized optimization actions

## Architecture

```
packages/
  core/     — Detection, adapters, DB, schemas (Zod), paths, policy engine, benchmarks
  cli/      — Commander CLI (13 commands), formatters, hooks (observer + advisors), dashboard
  mcp/      — MCP server (3 tools)
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
