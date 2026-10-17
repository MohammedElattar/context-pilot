# ContextPilot — Remaining Work

## Ready to Use Now
- Run `node packages/cli/dist/index.js setup` to register MCP server + hooks globally
- Restart Claude Code after setup for hooks and MCP tools to take effect
- Run `pnpm link --global` from `packages/cli/` for `contextpilot` command anywhere

## Completed
- [x] **Verify `tool_input` field in hook stdin** — confirmed correct
- [x] **Track Write/Edit tool file paths** — `file_writes` table (migration 003), observer tracks Write + Edit
- [x] **MCP tool tests** — `session-files.test.ts` with seeded DB
- [x] **CLI command tests** — `doctor.test.ts`, `tools.test.ts` with mocked core
- [x] **File write tracking tests** — `file-writes.test.ts`
- [x] **Dashboard file IO tables** — file reads/writes tables, `/api/file-reads` and `/api/file-writes` endpoints
- [x] **Dashboard auto-refresh indicator** — countdown timer
- [x] **Policy engine: cache read ratio** — `getCacheReadRatio()` wired into prompt-advisor
- [x] **Canary/auto mode behavior** — `PolicyActionType` enum, `getActionsForMode()` filters by mode, prompt-advisor uses mode-aware output
- [x] **Recovery delegation** — `contextpilot recover <handle>` delegates to Caveman MCP via stdio JSON-RPC
- [x] **Context window estimation** — `estimateContextWindowUsage()` from token_snapshots + model context limits, wired into prompt-advisor
- [x] **CI/CD** — `.github/workflows/ci.yml` (Node 20+22, pnpm, build, test)
- [x] **README.md** — installation, commands, architecture, development

## Completed (Runtime)
- [x] **Run `contextpilot setup` globally** — hooks + MCP registered in `~/.claude/settings.local.json` and `~/.claude.json`
- [x] **Test MCP server end-to-end** — JSON-RPC protocol verified: tools/list and tools/call work correctly
- [x] **npm link / global install** — `contextpilot` command available globally via npm link
- [x] **Fix setup path resolution** — `findProjectRoot()` walks up to `pnpm-workspace.yaml` for reliable paths

## Completed (Benchmark)
- [x] **Benchmark engine real testing** — 4/4 tasks pass, 100% success rate, 13-33s per task with `claude -p`

## Remaining Tasks

None. All TODO items complete.

## Architecture Notes for Continuing

- **Monorepo**: `packages/core` (shared logic), `packages/cli` (13 commands + hooks), `packages/mcp` (MCP server)
- **Build**: `pnpm -r build` — tsup (esbuild), ESM only
- **Test**: `pnpm test` — vitest, 50 tests across 11 files
- **DB**: SQLite via better-sqlite3 at `~/.context-pilot/telemetry.db`. WAL mode.
  - Tables: sessions, events, token_snapshots, adapter_snapshots, file_reads, file_writes
- **Policy engine**: 5 policies with `PolicyActionType` enum, mode-aware via `getActionsForMode()`
- **Hook safety**: Never write stdout on Caveman-hooked events. Safe: `UserPromptExpansion`, `PostCompact`, `PostModelSwitch`
- **Caveman constraint**: Read-only access. Never modify `~/.caveman/` files.
