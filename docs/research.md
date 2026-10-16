# ContextPilot Research Summary

Date: 2026-10-16

## Environment

- **Claude Code:** v2.1.301, model claude-opus-4-6
- **Caveman:** v4.0.1 (CLI @caveman-ai/cli, proxy bin-v4.0.1)
- **Node:** v24.18.0
- **OS:** Linux 7.0.0-38-generic x64

## Key Findings

### Hooks Run in Parallel
All matching hooks for an event run in parallel, not sequentially. Hooks from user-level and project-level settings merge additively. ContextPilot observer hooks (no stdout) are safe alongside Caveman.

### Status Line JSON is Richest Telemetry
Provides token counts, cache stats, cost, rate limits, prompt cache warm/cold, session metadata in one structured object.

### Hooks Run in `-p` Mode
`claude -p "prompt"` triggers hooks — benchmark engine via `-p` will work.

### PostToolUse is Best Observer Event
Provides `tool_name`, `tool_input`, `tool_response`, `duration_ms`. Good for telemetry without interference.

### SessionEnd Budget is 1.5s
Observer hook at SessionEnd must be fast. Can be extended up to 60s per hook.

### Hook Output Limit
`additionalContext`, `systemMessage`, `initialUserMessage`, plain stdout capped at 10,000 chars.

### Prompt Caching
- Subscription TTL: 1 hour. Usage credits: 5 minutes.
- Cache invalidated by: tool definition changes, system prompt changes.
- ContextPilot must not destabilize the prompt prefix.
- Cache reads: 0.05x-0.1x of base input cost.

## Tool Conflict Matrix

| Tool | PreToolUse | PostToolUse | Proxy | MCP | Caveman Conflict |
|------|-----------|-------------|-------|-----|-----------------|
| Caveman | Yes | Yes | Yes (8787) | Yes | N/A |
| RTK | Yes (Bash rewrite) | No | Optional | No | HIGH |
| context-mode | Yes | Yes | No | Yes | VERY HIGH |
| claude-mem | Yes | Yes | No | Yes | MEDIUM |
| Serena | No | No | No | Yes | LOW |
| ccusage | No | No | No | No | NONE |

## Licensing

| Tool | License | Can Integrate | Can Redistribute |
|------|---------|--------------|-----------------|
| RTK CLI | Apache-2.0 | Yes | Yes |
| RTK engine | BUSL-1.1 | Yes (adapter) | No |
| Serena app | GPL-3.0 | Yes (adapter) | Only if GPL |
| context-mode | ELv2 | Yes (adapter) | No |
| ccusage | MIT | Yes | Yes |
| claude-mem | Apache-2.0 | Yes | Yes |

ContextPilot uses adapter pattern: detect + configure, never bundle non-MIT/Apache tools.

## Unresolved

1. Hook parallel conflict resolution for stdout — which hook's output wins when multiple produce `hookSpecificOutput`?
2. Exact path of Claude Code JSONL session logs (ccusage reads them).
3. Caveman DB table schemas (no sqlite3 CLI, need better-sqlite3 inspection).
4. context-mode: no verified source repo. Adapter deferred.

## Detailed Research

- [research-claude-code.md](./research-claude-code.md) — Claude Code hooks, plugins, MCP, costs, status line
- [research-tools.md](./research-tools.md) — Third-party optimization tools, conflict analysis, licensing
