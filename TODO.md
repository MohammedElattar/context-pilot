# ContextPilot — Remaining Work

## Ready to Use Now
- Run `node packages/cli/dist/index.js setup` to register MCP server + hooks globally
- Restart Claude Code after setup for hooks and MCP tools to take effect

## Remaining Tasks

### High Priority
- [ ] **Run `contextpilot setup` globally** — currently hooks are only in project-level `.claude/settings.json`. Running setup registers them in `~/.claude/settings.local.json` so they work in all projects.
- [ ] **Test MCP server end-to-end** — the MCP server builds and the tools work in isolation, but needs testing inside a live Claude Code session to verify the JSON-RPC protocol works correctly with `@modelcontextprotocol/sdk`.
- [ ] **Verify `tool_input` field in hook stdin** — the observer parses `tool_input.file_path` from PostToolUse hook stdin. This field name needs verification against actual Claude Code hook payloads (might be `input` instead of `tool_input`).

### Medium Priority
- [ ] **More test coverage** — DB operations, MCP tool handlers, CLI commands, and dashboard API have minimal or no tests. Target areas:
  - `packages/mcp/src/tools/*.ts` — unit tests with seeded DB
  - `packages/cli/src/commands/*.ts` — integration tests
  - Dashboard API endpoints
- [ ] **Benchmark engine real testing** — `contextpilot benchmark` is built but untested with actual `claude -p` invocations. Run it and validate the comparison tables.
- [ ] **npm link / global install** — so `contextpilot` command works anywhere instead of `node packages/cli/dist/index.js`
- [ ] **Track Write/Edit tool file paths** — currently only tracks Read. Tracking writes would give a complete picture of files touched per session.

### Low Priority
- [ ] **Dashboard improvements** — add auto-refresh indicator, file read table, policy history chart, session timeline
- [ ] **Policy engine: context window percentage** — currently always null because Claude Code doesn't expose context window usage. Find a way to estimate it (e.g., sum of payload_bytes vs known context limit).
- [ ] **Policy engine: cache read ratio** — also null. Could estimate from Caveman history data (`cache_read_input_tokens / total_input`).
- [ ] **Canary/auto mode behavior** — modes exist as labels but canary/auto don't do anything differently from observe yet. Wire policy triggers to automatic actions in these modes.
- [ ] **Recovery delegation** — `contextpilot recover <ref>` delegating to Caveman's `caveman_retrieve` MCP tool
- [ ] **CI/CD** — GitHub Actions for build + test on push
- [ ] **README.md** — proper documentation for installation, setup, and usage

## Architecture Notes for Continuing

- **Monorepo**: `packages/core` (shared logic), `packages/cli` (commands + hooks), `packages/mcp` (MCP server)
- **Build**: `pnpm -r build` builds all. Uses tsup (esbuild wrapper). ESM only.
- **Test**: `pnpm test` runs vitest across all `**/*.test.ts` files
- **DB**: SQLite via better-sqlite3 at `~/.context-pilot/telemetry.db`. WAL mode. Migrations inline in `connection.ts`.
- **Hook safety**: Never write stdout on events Caveman hooks (all 10 standard events). Safe for stdout: `UserPromptExpansion`, `PostCompact`, `PostModelSwitch`.
- **Caveman constraint**: Read-only access. Never modify `~/.caveman/` files.
