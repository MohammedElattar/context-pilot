# @contextpilot/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for [ContextPilot](../../README.md). Exposes ContextPilot's telemetry to Claude during a session so the model can check its own token burn rate.

## Tools

| Tool | Description |
|------|-------------|
| `contextpilot_budget` | Session token budget summary with policy warnings |
| `contextpilot_session_files` | Per-file read counts, to help avoid re-reading files |
| `contextpilot_optimize` | Prioritized optimization actions for the current session |

All tools read from `~/.context-pilot/telemetry.db` (read-only).

## Setup

Registered automatically by `contextpilot setup`. The server binary is `contextpilot-mcp` (stdio transport).

To register manually, add to Claude Code's MCP config:

```json
{
  "mcpServers": {
    "contextpilot": {
      "command": "node",
      "args": ["<repo>/packages/mcp/dist/index.js"]
    }
  }
}
```

## Build

```bash
pnpm --filter @contextpilot/mcp build   # tsup, ESM only
```

MIT — see the [root LICENSE](../../LICENSE).
