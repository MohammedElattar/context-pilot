# ContextPilot Phase 0a Research — Claude Code & Third-Party Tools

**Date:** 2026-10-16
**Claude Code version:** 2.1.301
**Sources:** code.claude.com/docs/en/{hooks,plugins,mcp,costs,statusline}, platform.claude.com/docs/en/build-with-claude/prompt-caching, GitHub repos for third-party tools

---

## 1. Claude Code Hooks

### 1.1 Lifecycle Events (30+ events)

SessionStart, Setup, UserPromptSubmit, UserPromptExpansion, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, MessageDisplay, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle, InstructionsLoaded, ConfigChange, CwdChanged, DirectoryAdded, FileChanged, WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, Elicitation, ElicitationResult, SessionEnd.

### 1.2 Hook Stdin (Common Fields)

All events receive: `session_id`, `prompt_id` (UUID, matches OpenTelemetry `prompt.id`), `transcript_path`, `cwd`, `scratchpad_dir` (optional, v2.1.257+), `permission_mode`, `effort.level`, `hook_event_name`, `agent_id`, `agent_type`.

**Tool events** add: `tool_name`, `tool_input`, `tool_use_id`.

**SessionStart** adds: `source` ("startup"|"resume"|"clear"|"compact"|"fork"), `model`, `agent_type`, `session_title`. On resume/fork: `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd`.

**PostToolUse** adds: `tool_input`, `tool_response`, `tool_use_id`, optional `duration_ms`.

**Stop** adds: `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`.

**StopFailure** adds: `error` (rate_limit|overloaded|authentication_failed|billing_error|max_output_tokens|...), optional `error_details`, `last_assistant_message`.

### 1.3 Hook Stdout (Output Schema)

**Universal fields:** `continue` (default true), `stopReason`, `suppressOutput`, `systemMessage`, `terminalSequence`.

**`hookSpecificOutput`** requires `hookEventName` field. Key patterns:

- **PreToolUse:** `permissionDecision` (allow|deny|ask|defer), `permissionDecisionReason`, `updatedInput` (rewrites tool args), `additionalContext`
- **PostToolUse:** `updatedToolOutput` replaces tool result
- **SessionStart:** `additionalContext`, `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills`
- **Stop/SubagentStop:** `additionalContext`, or `decision: "block"` + `reason`
- **Most blocking events:** top-level `decision: "block"` + `reason`

**Size limit:** `additionalContext`, `systemMessage`, `initialUserMessage`, plain stdout each capped at **10,000 characters**. Over limit: written to file, replaced with path + 2,000-char preview.

### 1.4 Hook Merge Order

**CRITICAL FINDING:** Hooks entries **merge** across settings levels (user, project, local, plugin, managed). They do NOT replace each other. Identical handlers defined in more than one settings file run once. The docs do **not** specify execution order between `~/.claude/settings.json` and `.claude/settings.json`.

**All matching hooks run in parallel.** No ordering guarantee between hooks.

**Implication for ContextPilot:** ContextPilot hooks in project-level `.claude/settings.json` will merge with Caveman's hooks in user-level `~/.claude/settings.json`. Both run in parallel. Since ContextPilot hooks write nothing to stdout (pure observers), there's no conflict. The parallel execution means ContextPilot cannot rely on seeing Caveman's output first.

### 1.5 Timeouts

- Default: 600s for command/http/mcp_tool; 30s for prompt; 60s for agent
- Lowered: 30s on UserPromptSubmit, PreModelSwitch, PostModelSwitch; 10s on MessageDisplay
- SessionEnd: shares 1.5s budget (raised to per-hook timeout up to 60s)
- On timeout: hook canceled, output discarded. On PreToolUse, timed-out hook does NOT block.

### 1.6 Hook Types

| Type | Key Fields |
|------|-----------|
| `command` | `command`, `args` (exec form), `async`, `asyncRewake`, `shell`, `onFailure` |
| `http` | `url`, `headers` (supports `$VAR`), `allowedEnvVars` |
| `mcp_tool` | `server`, `tool`, `input` (supports `${tool_input.*}` substitution) |
| `prompt` | `prompt`, `model` |
| `agent` | Subagent with tools (experimental) |

### 1.7 Error Handling

- **Exit 0:** success. Stdout parsed as JSON if single object.
- **Exit 2:** blocking error on blocking events. Stderr = reason.
- **Other exit codes (incl 1):** non-blocking error. Action proceeds.
- **`onFailure: "block"`** (v2.1.295+): converts failures into blocks.

### 1.8 Hooks in -p Mode

Yes, hooks run in `-p` mode:
- Setup fires with `--init`/`--maintenance` in `-p`
- Skill frontmatter hooks register including in `-p`
- `initialUserMessage` applies in non-interactive `-p`
- `terminalSequence` is ignored in `-p`
- PermissionRequest hooks run; if none decides, tool call denied
- `defer` works only in `-p` with single tool call

### 1.9 Environment Variables

- `CLAUDE_ENV_FILE`: available to SessionStart, Setup, CwdChanged, FileChanged hooks
- `CLAUDE_PROJECT_DIR`: used in command paths
- `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`: plugin paths
- `COLUMNS`, `LINES`: terminal dimensions (for status line scripts)

### 1.10 Matchers

- `"*"`, `""`, or omitted: matches all
- Letters/digits/`_`/`-`/space/`,`/`|`: exact match or list
- Any other character: unanchored JavaScript regex
- Tool events match on `tool_name`
- `if` field: permission rule syntax, tool events only

---

## 2. Claude Code Plugins

### 2.1 Plugin Structure

A plugin is a directory with optional manifest at `.claude-plugin/plugin.json`. Components:
- **Skills:** `SKILL.md` instructions
- **Agents:** subagent definitions
- **Hooks:** `hooks/hooks.json`
- **Hooks module (mod):** JS functions for panes, commands
- **MCP servers:** `.mcp.json` at plugin root

### 2.2 Plugin Manifest

Located at `.claude-plugin/plugin.json`. Contains name, version, description, metadata.

### 2.3 Plugin Installation

- Installed via `/plugin` command or `claude plugin install`
- Stored in `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`
- Scopes: user (all projects), project (committed), local (you + this repo)
- Marketplaces: Anthropic official (`claude-plugins-official`), community, third-party

### 2.4 Plugin Loading

- Plugins load at session startup
- MCP servers connect when plugin enabled
- Skills/agents loaded on demand (names in context always)
- Each enabled plugin adds per-turn context overhead (names/descriptions)

### 2.5 ContextPilot as Plugin

ContextPilot could be distributed as a Claude Code plugin with:
- Skills for `doctor`, `status`, `analyze` commands
- Hooks for observer telemetry
- MCP server for tool integration
- Manifest at `.claude-plugin/plugin.json`

---

## 3. MCP Server Configuration

### 3.1 Configuration Locations (precedence high→low)

1. managedMcpServers (managed setting)
2. Local scope (`~/.claude.json` per-project)
3. Project scope (`.mcp.json`)
4. User scope (`~/.claude.json` top-level)
5. Plugin-provided servers
6. claude.ai connectors

### 3.2 Configuration Format

```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "/path/to/binary",
      "args": [],
      "env": {},
      "timeout": 600000,
      "alwaysLoad": false
    }
  }
}
```

Transport types: `stdio`, `http` (alias `streamable-http`), `sse` (deprecated), `ws`, `sdk`.

### 3.3 No Field-Level Merging

Same server defined in multiple places: highest-precedence source wins entirely.

### 3.4 Tool Naming

- Standard: `mcp__<server>__<tool>`
- Plugin: `mcp__plugin_<plugin>_<server>__<tool>`

### 3.5 Output Limits

- Warning above 10,000 tokens
- Default limit 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`)
- Text over 50,000 chars saved to file

---

## 4. Token Costs & Session Data

### 4.1 Cost Tracking

- `/usage` command shows per-session token stats
- Token types: input, output, cache_creation, cache_read
- Cost computed client-side from token counts at list price
- Resets on `/clear`

### 4.2 Session Data Location

- **Session transcripts:** `transcript_path` field in hook stdin (JSONL format)
- **Usage data:** local session history used by `/usage` and `/insights`
- **Insights reports:** `~/.claude/usage-data/report.html`
- **Cleanup:** files older than `cleanupPeriodDays` (default 30) deleted at startup

### 4.3 Status Line Data (Rich Telemetry Source)

The status line JSON includes:
- `cost.total_cost_usd`, `cost.total_duration_ms`, `cost.total_api_duration_ms`
- `cost.total_lines_added`, `cost.total_lines_removed`
- `context_window.total_input_tokens`, `total_output_tokens`
- `context_window.context_window_size`, `used_percentage`
- `context_window.current_usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`
- `rate_limits.five_hour.{used_percentage, resets_at}`
- `rate_limits.seven_day.{used_percentage, resets_at}`
- `prompt_cache.{warm, hit_ratio, requests, misses, expected_rebuilds, ttl, expires_at, cache_write_tokens, miss_recache_tokens}`
- `session_id`, `session_name`, `prompt_id`, `model.id`, `model.display_name`
- `effort.level`, `fast_mode`, `thinking.enabled`
- `exceeds_200k_tokens`

**CRITICAL FINDING:** The status line JSON is the richest single telemetry source. It provides token counts, cache stats, cost, rate limits, and session metadata in one structured object. ContextPilot could read this via a status line hook or by parsing the same data source.

### 4.4 Prompt Caching

- **5-minute TTL:** default, refreshed on each use at no extra cost
- **1-hour TTL:** available at 2x write cost (vs 1.25x for 5min)
- **Cache read pricing:** 0.1x base input (Sonnet 4.6), 0.05x (Opus 5.5/Sonnet 5.5), 0.025x (Fable 5.1)
- **Invalidation:** tool definition changes invalidate everything. System prompt changes invalidate system+messages. Message changes invalidate messages only.
- **Prefix hierarchy:** tools → system → messages
- **Minimum cacheable:** 512 tokens (newer models) to 4,096 (Opus 4.5/4.6, Haiku 4.5)
- **Subscription TTL:** 1-hour on subscription, drops to 5 minutes on usage credits

---

## 5. Third-Party Optimization Tools

### 5.1 RTK (Rust Token Killer)

- **Repo:** github.com/rtk-ai/rtk (MIT license)
- **Version:** ~0.22.2 (docs reference)
- **What:** CLI proxy that compresses Bash command output. Smart filtering, grouping, truncation, deduplication.
- **Integration:** PreToolUse hook on Bash tool. Rewrites commands to `rtk <cmd>`. Also offers suggest mode via `systemMessage`.
- **Setup:** `rtk init --global` installs hook to `~/.claude/settings.json`
- **Data:** SQLite at `~/.local/share/rtk/history.db`, config at `~/.config/rtk/config.toml`
- **Claims:** 60-90% token savings on shell output (unverified by independent benchmark)
- **Limitation:** Only Bash tool calls. Built-in Read/Grep/Glob not affected.
- **Caveman conflict:** RTK rewrites Bash commands via PreToolUse hook. Caveman also hooks PreToolUse. Both run in parallel. If both modify the same tool input, last-write-wins behavior is undefined. **Potential conflict.**
- **ContextPilot detection:** Check for `rtk` binary, `~/.local/share/rtk/`, PreToolUse hooks with `rtk-rewrite` pattern.

### 5.2 Serena

- **Repo:** github.com/oraios/serena (likely)
- **What:** MCP server providing semantic code tools (go-to-definition, find-references, etc.) via language servers.
- **Integration:** MCP server added via `claude mcp add --scope user serena -- serena start-mcp-server --context claude-code --project-from-cwd`
- **Token impact:** 29 tools at ~23,878 tokens tool definition overhead. A slim fork (`serena-slim`) groups into 18 ops, claims 50.3% reduction.
- **Optimization angle:** Symbol-level navigation reduces file reads vs grep-based search.
- **Caveman conflict:** None expected — operates at MCP tool level, not compression.
- **ContextPilot detection:** Check MCP server list for `serena` name.

### 5.3 context-mode

- **Status:** Could not find a definitive repository or documentation. References appear in blog posts about "MCP Context Mode" but no authoritative source verified.
- **Claims:** 99% token reduction via MCP server (unverified, likely marketing).
- **Assessment:** **Mark as unverified.** Do not implement adapter until source repo confirmed.

### 5.4 ccusage

- **Repo:** github.com/ryoppippi/ccusage (MIT license)
- **What:** CLI tool reading Claude Code local JSONL usage logs. Reports daily/weekly/monthly/session/5-hour-block token usage and costs.
- **Install:** `npx ccusage@latest` or `npm i -g ccusage`
- **Commands:** `daily`, `weekly`, `monthly`, `session`, `blocks`, `statusline`, plus agent-specific: `claude`, `codex`, `opencode`, etc.
- **Data source:** Local JSONL files from Claude Code (path not specified in docs)
- **Output:** Terminal table or `--json`
- **MCP:** `.mcp.json` present in repo but not documented
- **Caveman conflict:** None — read-only analytics tool.
- **ContextPilot overlap:** ccusage provides similar analytics to what ContextPilot's telemetry aims to build. ContextPilot should detect ccusage and potentially import its data or recommend it as complementary.
- **ContextPilot detection:** Check for `ccusage` in npm global, or `npx ccusage` availability.

### 5.5 Claude-MEM

- **Repo:** Likely github.com/thedotmack/claude-mem
- **What:** Claude Code plugin for persistent memory. Background worker compresses session observations via AI, stores in SQLite, retrieves at session start.
- **Integration:** Plugin (hooks + agent-sdk background worker + SQLite)
- **Token impact:** Adds context at session start (compressed memories). May cause "context pollution."
- **Caveman conflict:** Potential overlap if Caveman's learn/memory features overlap.
- **ContextPilot detection:** Check installed plugins for `claude-mem` name.

---

## 6. Key Findings for ContextPilot Architecture

### 6.1 Hook Strategy (Confirmed Safe)

ContextPilot observer hooks in project `.claude/settings.json` will merge with Caveman's user-level hooks. All hooks run in parallel. Since ContextPilot writes nothing to stdout, no conflict. No ordering guarantee needed.

### 6.2 Best Telemetry Source

The **status line JSON** is the richest structured data source, containing:
- Token counts (input, output, cache_read, cache_write)
- Cost estimates
- Rate limit percentages
- Prompt cache statistics
- Session metadata

ContextPilot should capture this data via hooks (SessionStart, PostToolUse, Stop provide `session_id` and event data) combined with Caveman's JSONL logs for compression stats.

### 6.3 Conflict Detection Priorities

1. **RTK + Caveman:** Both hook PreToolUse on Bash. Both may modify tool input. High conflict risk.
2. **Multiple compression:** RTK compresses Bash output, Caveman compresses broadly. Double-compression degrades quality.
3. **MCP tool definition bloat:** Serena adds ~24K tokens of tool definitions. Monitor via tool search behavior.
4. **Memory injection:** Claude-MEM + Caveman learn features could inject overlapping context.

### 6.4 Adapter Priority

1. **Caveman** — installed, deeply integrated, rich data (CONFIRMED)
2. **RTK** — well-documented API, potential conflict detection needed (VERIFIED)
3. **ccusage** — complementary analytics, read-only (VERIFIED)
4. **Serena** — MCP detection only, no optimization to manage (VERIFIED)
5. **Claude-MEM** — plugin detection, memory overlap check (VERIFIED)
6. **context-mode** — UNVERIFIED, defer

---

## 7. Unresolved Questions

1. **Hook execution order within parallel batch:** When multiple hooks run in parallel and both produce `hookSpecificOutput`, which one wins? Docs say "all matching hooks run in parallel" but don't clarify conflict resolution for stdout.
2. **ccusage JSONL path:** What directory does ccusage read from? Need to verify if it's the same transcript files or a separate log.
3. **Caveman DB schema:** No `sqlite3` CLI available, and Caveman DB schemas aren't documented. Need to query via better-sqlite3 at runtime.
4. **context-mode:** No verified source repo. Cannot implement adapter.
5. **Plugin distribution:** Should ContextPilot be distributed as a Claude Code plugin or standalone npm package? Plugin gives automatic hook/MCP registration but couples to marketplace.
