# @contextpilot/cli

The `contextpilot` command-line interface for [ContextPilot](../../README.md), plus the Claude Code hook scripts (observer + advisors).

## Install

The CLI is built as part of the workspace. From the repo root:

```bash
pnpm -r build
cd packages/cli && pnpm link --global   # exposes `contextpilot` / `context-pilot`
```

Or run without linking: `node packages/cli/dist/index.js <command>`.

## Commands

| Command | Description |
|---------|-------------|
| `doctor` | Inspect environment, Claude Code, Caveman, hooks, conflicts |
| `status` | Current optimization state and recent telemetry |
| `analyze` | Token usage analysis from telemetry history |
| `tools` | Detected optimization tools, capabilities, conflicts |
| `report` | Comprehensive optimization report |
| `mode [name]` | Show or set operating mode (`observe`, `canary`, `auto`) |
| `benchmark` | Run token optimization benchmarks via `claude -p` |
| `policies` | Evaluate optimization policies against current telemetry |
| `dashboard` | Local web dashboard at `http://127.0.0.1:3141` |
| `setup` | Register the MCP server and hooks globally |
| `rollback` | Roll back to observe mode |
| `recover <handle>` | Recover compressed content via Caveman MCP |

All commands support `--json` for machine-readable output.

## Hooks

Built alongside the CLI and registered by `contextpilot setup`:

- `observer` — records telemetry to `~/.context-pilot/telemetry.db`. Never writes stdout.
- `prompt-advisor` — injects optimization hints on `UserPromptExpansion` when policies trigger.
- `compact-advisor` — injects budget status on `PostCompact`.

Advisors only run on events Caveman does not own, so output never collides.

MIT — see the [root LICENSE](../../LICENSE).
