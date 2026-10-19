# @contextpilot/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for [ContextPilot](../../README.md). Exposes ContextPilot's telemetry to Claude during a session so the model can check its own token burn rate.

## Tools

| Tool | Description |
|------|-------------|
| `contextpilot_budget` | Session token budget summary with policy warnings |
| `contextpilot_session_files` | Per-file read counts, to help avoid re-reading files |
| `contextpilot_optimize` | Prioritized optimization actions for the current session |
| `contextpilot_search` | Open-web search → ranked result URLs + snippets (SearXNG / Brave / native fallback) |
| `contextpilot_fetch` | Fetch one URL (web/doc/PDF) as ranked, budget-capped, cached evidence with stable `evidence_id`s |
| `contextpilot_research` | Research a question across several URLs (web/docs + GitHub issues/PRs); merged, ranked, budgeted |
| `contextpilot_expand` | Recover an omitted section or the full page by `evidence_id`, from cache, no network |
| `contextpilot_research_state` | Routing adoption, cache hit-rate, and estimated tokens saved for the session |

The telemetry tools (`budget`, `session_files`, `optimize`, `research_state`) read from `~/.context-pilot/telemetry.db` (read-only). The research-gateway tools (`fetch`, `research`, `expand`) also write a local cache + evidence ledger to the same DB. All tools fail open — on error they return a structured result pointing at the native fallback, never throwing.

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
