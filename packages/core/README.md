# @contextpilot/core

Shared logic for [ContextPilot](../../README.md): detection, adapters, telemetry storage, policy engine, and benchmarks. Consumed by `@contextpilot/cli` and `@contextpilot/mcp`.

## What's inside

| Area | Exports |
|------|---------|
| **Detection** | `detectEnvironment`, `detectHooks`, `detectPlugins`, `detectProxy`, `detectConflicts` |
| **Adapters** | `detectAllTools`, `OptimizerAdapter` (read-only integration with tools like Caveman) |
| **Config** | `loadConfig`, `saveConfig`, `setMode`, `paths` |
| **Policy engine** | `evaluatePolicies`, `getActionsForMode`, `ALL_POLICIES` |
| **Database** | `getDb`, `openReadOnly` — SQLite (better-sqlite3), WAL mode, at `~/.context-pilot/telemetry.db` |
| **Benchmarks** | `runBenchmark`, `BUILTIN_TASKS` |

All external-data schemas use Zod with `.passthrough()` for forward compatibility.

## Build

```bash
pnpm --filter @contextpilot/core build   # tsup, ESM only
```

MIT — see the [root LICENSE](../../LICENSE).
