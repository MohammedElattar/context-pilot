# ContextPilot Phase 0a Research — Claude Code Optimization Tools

Research date: 2026-10-16

---

## 1. Claude Code Hooks (Official Docs)

Source: https://code.claude.com/docs/en/hooks

### Hook Events
Per-session: SessionStart, SessionEnd, Setup
Per-turn: UserPromptSubmit, UserPromptExpansion, Stop, StopFailure
Per-tool: PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch
Other: SubagentStart, SubagentStop, TaskCreated, TaskCompleted, TeammateIdle, Notification, MessageDisplay, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, Elicitation, ElicitationResult, InstructionsLoaded, ConfigChange, CwdChanged, DirectoryAdded, FileChanged, WorktreeCreate, WorktreeRemove

### Handler Types
- `command`: shell command, stdin JSON, stdout JSON/text
- `http`: POST to URL
- `mcp_tool`: call MCP server tool
- `prompt`: single-turn Claude evaluation
- `agent`: subagent with Read/Grep/Glob tools (experimental)

### Stdin JSON (common fields)
`session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `effort`, `hook_event_name`, `agent_id`, `agent_type`

### PostToolUse-specific fields
`tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms`

### Stdout Contract
- Exit 0 + JSON: parsed as output. Fields: `continue`, `stopReason`, `suppressOutput`, `systemMessage`, `terminalSequence`, `hookSpecificOutput`
- Exit 0 + plain text: added to context only for UserPromptSubmit, UserPromptExpansion, SessionStart, PostModelSwitch
- Exit 2: blocking error (on events that support blocking)
- Other non-zero: non-blocking error
- Size cap: `additionalContext`, `systemMessage`, `initialUserMessage`, plain stdout capped at 10,000 chars. Larger saved to file, 2,000-char preview to Claude.

### CRITICAL: Multiple Hooks on Same Event Run in PARALLEL
All matching handlers run in parallel, not sequentially. Identical handlers across settings files run once. Plugin/skill copies stay separate.

### Configuration Merge Order
| Location | Scope |
|---|---|
| `~/.claude/settings.json` | User-level (all projects) |
| `.claude/settings.json` | Project-level (committed) |
| `.claude/settings.local.json` | Project-level (gitignored) |
| Managed policy settings | Organization-wide |
| Plugin `hooks/hooks.json` | While plugin enabled |
| Skill/subagent frontmatter | During invocation |

Hook entries are **additive** across levels. User + project + local all contribute hooks. No override/removal.

### Timeouts
- Default: 600s for command/http/mcp_tool; 30s for prompt; 60s for agent
- Lowered: 30s on UserPromptSubmit, PreModelSwitch, PostModelSwitch; 10s on MessageDisplay
- SessionEnd: shares 1.5s budget (extendable to 60s per hook)

### Env Var Persistence
SessionStart, Setup, CwdChanged, FileChanged hooks can write to `CLAUDE_ENV_FILE` to persist env vars for subsequent Bash commands.

### ContextPilot Implications
1. Observer hooks can safely run in parallel with Caveman — they write nothing to stdout
2. Hooks are additive — project-level `.claude/settings.json` hooks add to user-level, no conflict
3. PostToolUse provides `tool_response` and `duration_ms` — good telemetry source
4. 10,000 char cap on additionalContext limits what hooks can inject
5. SessionEnd has only 1.5s budget — observer must be fast

---

## 2. Prompt Caching (Official Docs)

Source: https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching

### Key Mechanics
- Two modes: automatic (one top-level `cache_control`) and explicit (up to 4 breakpoints)
- Prefix order: tools → system → messages
- 100% identical content required for cache match
- Cache isolated per organization

### TTL
- 5-minute default (`{"type": "ephemeral"}`) — refreshed on each read
- 1-hour option (`{"type": "ephemeral", "ttl": "1h"}`) — costs more

### Pricing (per million tokens, selected)
| Model | Base input | Cache read | Ratio |
|---|---|---|---|
| Opus 4.6 | $5 | $0.50 | 0.1x |
| Sonnet 4.6 | $3 | $0.30 | 0.1x |
| Opus 5.5 | $4 | $0.20 | 0.05x |
| Sonnet 5.5 | $2 | $0.10 | 0.05x |

### Minimum Cacheable Length
- 512 tokens: Opus 5+, Sonnet 5.5, Haiku 5.5
- 1,024 tokens: Opus 4.8, Sonnet 5, Sonnet 4.6
- 4,096 tokens: Opus 4.5, Opus 4.6

### Cache Invalidation Triggers
- Changing tool definitions invalidates everything
- Changing system prompt invalidates system + messages
- Changing tool_choice, images, thinking config, output_config.effort → invalidates messages
- Toggling web search or citations → changes system prompt

### ContextPilot Implications
1. Token optimization should not destabilize the prompt prefix — that breaks cache
2. Caveman compression that modifies system/tool definitions could invalidate cache every turn
3. cache_read_input_tokens available in usage response — key telemetry metric
4. For subscription users, cache reads are significantly cheaper — maximizing cache hits is a primary optimization
5. total_input = cache_read + cache_creation + input_tokens

---

## 3. RTK (Rust Token Killer)

Source: https://github.com/rtk-ai/rtk
Stars: 83.6k | Forks: 5.3k

### What It Does
CLI proxy that filters/compresses terminal command output before it reaches the model. Claims 60-90% token savings with <10ms overhead across 100+ commands.

### Integration
- **Hooks**: `rtk init -g` installs a PreToolUse hook that rewrites Bash commands (e.g., `git status` → `rtk git status`)
- **Proxy**: Optional RTK Proxy daemon routes API traffic. `rtk claude` starts daemon + launches Claude through it.
- **MCP**: Not mentioned
- **Limitation**: Hook only fires on Bash tool calls. Built-in Read, Grep, Glob bypass it.

### License
- `rtk` CLI: Apache-2.0
- `rtk-engine` and `rtk-proxy`: BUSL-1.1
- `rtk-oss`: Apache-2.0-only edition without engine

### Caveman Conflict Potential: HIGH
- Both use PreToolUse hooks to modify Bash commands
- Both can run a proxy daemon
- RTK rewrites commands; Caveman compresses output — different layers but both touch Bash tool calls
- If both hooks run in parallel on PreToolUse, both would try to modify the command — unpredictable behavior

### Subscription Relevance
Useful. Reduces context consumption regardless of billing model.

### Maintenance Status
2,400 commits on develop. No release dates visible. Active community (83.6k stars).

---

## 4. Serena

Source: https://github.com/oraios/serena
Stars: 30.3k | Forks: 2.1k

### What It Does
MCP toolkit providing IDE-like semantic retrieval and editing. Backed by language servers (LSP). Gives agents symbol lookup, semantic editing, refactoring, debugging.

### Integration
- **MCP**: Primary integration. Exposes tools for symbol search, refactoring, semantic editing, debugging, and file operations.
- **Hooks**: Not mentioned
- **Proxy**: Not mentioned
- Setup: `uv tool install -p 3.13 serena-agent`, then `serena init`, then add MCP config to client

### MCP Tools Provided
- Retrieval: find_symbol, symbol_overview, find_referencing_symbols, find_declaration, find_implementations, diagnostics
- Refactoring: rename (both backends), move/inline (JetBrains only)
- Symbolic editing: replace_symbol_body, insert_before/after, safe_delete
- Debugging: interactive REPL (JetBrains only)
- Basic: search_for_pattern, replace_content, list_dir, find_file, read_file, execute_shell_command

### License
- SolidLSP component: MIT
- Rest of Serena: GPL-3.0-or-later
- Combined distribution: GPL applies

### Caveman Conflict Potential: LOW
- Different layer entirely (MCP tools vs proxy/hooks)
- No overlapping compression — Serena does retrieval, not compression
- Could conflict on MCP tool name collisions if both register file operation tools

### Subscription Relevance
Indirect. More efficient code navigation = fewer wasted file reads = fewer tokens. No direct compression.

### Token Claims
Qualitative only: "much more token-efficient than typical alternatives" for editing. No quantified savings.

### Fork: serena-slim
Claims 50.3% reduction in tool-definition tokens (29 tools → 18 grouped operations). Unverified.

---

## 5. context-mode

Source: https://github.com/mksglu/context-mode
Stars: 30.2k | Forks: 2.1k

### What It Does
Context-window optimization: sandboxes tool output (claims 98% reduction, 315KB → 5.4KB), persists session memory, routes tool use across 17 platforms.

### Integration
- **Plugin (recommended)**: `/plugin marketplace add mksglu/context-mode`, `/plugin install context-mode@context-mode`
- **Hooks**: Registers 6 hooks: PreToolUse, PostToolUse, UserPromptSubmit, PreCompact, SessionStart, Stop
- **MCP**: 11 tools — 6 sandbox tools (`ctx_execute`, `ctx_search`, etc.) + 5 meta-tools (`ctx_stats`, `ctx_doctor`, `ctx_upgrade`, `ctx_purge`, `ctx_insight`)
- **MCP-only alternative**: `claude mcp add context-mode -- npx -y context-mode`

### License
Elastic License 2.0 (ELv2)
**Redistribution restriction**: ELv2 prohibits providing the software as a managed service. ContextPilot cannot bundle or redistribute context-mode.

### Caveman Conflict Potential: VERY HIGH
- Both hook PreToolUse, PostToolUse, UserPromptSubmit, PreCompact, SessionStart, Stop
- Both compress/sandbox tool output
- Both persist session state
- Running both simultaneously: hooks run in parallel, both try to modify tool output → race condition
- Both store in SQLite — no DB conflict, but semantic overlap in what they track

### Subscription Relevance
Useful. Reduces context consumption. Session memory helps with compaction recovery.

### Maintenance
2,235 commits. Active community (30.2k stars).

---

## 6. ccusage

Source: https://github.com/ryoppippi/ccusage (note: repo appears to be under ccusage org now)
Stars: 19.0k | Forks: 879

### What It Does
Read-only CLI that analyzes local JSONL session logs from Claude Code (and other agent CLIs). Reports token usage and estimated costs.

### Integration
- **No hooks, no MCP, no proxy** — purely reads existing log files
- Supports status line hook for Claude Code (Beta): `ccusage statusline`
- Can aggregate from multiple Claude config directories

### CLI Commands
- `ccusage daily`, `weekly`, `monthly`, `session`
- `ccusage blocks` — Claude Code 5-hour billing windows
- `ccusage statusline` — status line for hooks
- Options: `--json`, `--since`/`--until`, `--breakdown`, `--offline`, `--compact`

### License
MIT

### Caveman Conflict Potential: NONE
Read-only. No modification of any state.

### Subscription Relevance
Highly useful. Tracks 5-hour billing windows, which is subscription-specific.

### ContextPilot Implications
- ccusage reads the same JSONL logs ContextPilot could read
- Its log parsing logic is a reference for understanding Claude Code's session log format
- MIT license allows referencing/adapting parsing approach
- ContextPilot telemetry should provide superset of ccusage data

---

## 7. claude-mem

Source: https://github.com/thedotmack/claude-mem
Stars: 101.2k | Forks: 8.9k

### What It Does
Persistent memory across sessions. Captures tool use, file reads, edits during sessions. Compresses with AI, stores in SQLite + Chroma vector DB, retrieves relevant context for new sessions.

### Integration
- **Plugin**: `/plugin marketplace add thedotmack/claude-mem`, `/plugin install claude-mem`
- **Hooks**: 6 hooks — SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SessionEnd
- **MCP**: 3-4 search tools (`search`, `timeline`, `get_observations`)
- **Skill**: `mem-search` for natural language queries
- **Web UI**: http://localhost:37777

### License
Apache-2.0

### Caveman Conflict Potential: MEDIUM
- Both hook SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SessionEnd
- Hooks run in parallel so no ordering issue for observers
- claude-mem is primarily an observer (like ContextPilot plans to be) — it records but doesn't modify tool output
- Risk: if claude-mem injects context via SessionStart stdout, and Caveman also injects, both are additive (both show in context)
- Performance: 6 parallel hooks per event adds latency

### Storage
- SQLite + Chroma vector DB at ~/.claude-mem/
- FTS5 full-text search
- Optional Cloud Sync to cmem.ai (data leaves local machine)

### Warnings
- Default provider is "CMEM Pro" (hosted) — requires sign-in, 30-day trial, then falls back to Anthropic plan
- `CLAUDE_MEM_ONLINE_OPTIN=false` keeps it local-only
- Associated crypto token "CMEM" — unrelated to software function but reputational concern
- npm install alone doesn't register hooks — must use plugin commands or `npx claude-mem install`

### Subscription Relevance
Indirect. Better context = fewer repeated file reads = fewer tokens. Memory compression uses tokens itself (calls Claude).

---

## 8. Other Tools Discovered

### CodeBurn (getagentseal/codeburn)
Reads same logs as ccusage but focuses on "what did I spend it on." Multiple provider support. MIT likely.

### ccburn
Python terminal tool showing consumption rate relative to billing windows.

### Claude-Code-Usage-Monitor (Maciek-roboblog)
Real-time terminal tracker predicting cap hits.

### claude-usage (phuryn/claude-usage)
Local dashboard with charts + VS Code extension.

### cctx
Local Ollama-powered compression: codebase indexing, tool output compression, turn summarization. Claims 70-90% reduction. Requires local GPU.

### token-optimizer-mcp (ooples)
TypeScript MCP server claiming 95% reduction. 403 stars.

### claude-context-optimizer (egorfedorov)
Tracks wasted file reads.

### Mibayy/token-savior
One independent benchmark showed ~43% reduction vs vanilla baseline.

### claude-token-efficient (drona23)
CLAUDE.md instruction file enforcing concise outputs. ~40% reduction in same benchmark.

---

## 9. Conflict Matrix

| Tool | PreToolUse | PostToolUse | UserPromptSubmit | SessionStart | Proxy | MCP | Conflicts with Caveman |
|---|---|---|---|---|---|---|---|
| Caveman | Yes (all hooks) | Yes | Yes | Yes | Yes (port 8787) | Yes (compress/retrieve/stats) | N/A |
| RTK | Yes (rewrites Bash) | No | No | No | Optional | No | HIGH — both modify Bash calls |
| context-mode | Yes | Yes | Yes | Yes | No | Yes (11 tools) | VERY HIGH — overlapping hooks + compression |
| claude-mem | Yes | Yes | Yes | Yes | No | Yes (3-4 tools) | MEDIUM — observer overlap, context injection |
| Serena | No | No | No | No | No | Yes (many tools) | LOW — different layer |
| ccusage | No | No | No | No | No | No | NONE — read-only |

---

## 10. Licensing Summary for ContextPilot

| Tool | License | Can ContextPilot integrate? | Can ContextPilot redistribute? |
|---|---|---|---|
| RTK CLI | Apache-2.0 | Yes (adapter) | Yes |
| RTK engine/proxy | BUSL-1.1 | Yes (adapter, no hosting) | No |
| Serena (SolidLSP) | MIT | Yes | Yes |
| Serena (app) | GPL-3.0 | Yes (adapter) | Only if ContextPilot is GPL |
| context-mode | ELv2 | Yes (adapter) | No (managed service restriction) |
| ccusage | MIT | Yes | Yes |
| claude-mem | Apache-2.0 | Yes (adapter) | Yes |

ContextPilot should use adapter pattern (detect + configure) rather than bundle any non-MIT/Apache tool.

---

## 11. Unresolved Questions

1. **Claude Code session log format**: Where exactly are JSONL session logs stored? ccusage reads them — need to find path. Likely `~/.claude/projects/*/sessions/` or similar.
2. **Hook ordering within parallel execution**: If two hooks both produce `hookSpecificOutput` with conflicting `permissionDecision`, which wins?
3. **Caveman proxy + RTK proxy**: Can both run simultaneously on different ports? Or does ANTHROPIC_BASE_URL only support one?
4. **context-mode + Caveman**: Has anyone tested them together? The hook overlap suggests breakage.
5. **claude --print hook firing**: Does `claude -p` trigger hooks? Critical for benchmark engine.
6. **Caveman DB schema**: No sqlite3 CLI on system. Need better-sqlite3 to inspect table schemas.
7. **Cache behavior under Caveman proxy**: Does Caveman's proxy preserve Anthropic's prompt caching? Or does routing through localhost break cache isolation?
