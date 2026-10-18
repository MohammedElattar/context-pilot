# ContextPilot Extension SDK — Design (P2-5)

Status: **design only.** No code is shipped yet, deliberately: an SDK with zero
plugins is speculative scaffolding. This document fixes the contract so the first
real extension need can be met without redesign.

## Goal

Let third parties add, without forking: agent adapters, optimization-tool
integrations, telemetry sources, policy evaluators, recommendation providers,
exporters, and dashboard panels — under an explicit trust and permission model,
with error isolation so a faulty plugin never breaks ContextPilot or Claude Code.

## Trust & security model

- Plugins are **ordinary Node modules the user installs explicitly**; there is no
  remote fetch and no auto-discovery of arbitrary code. A plugin runs with the
  user's privileges — the SDK does not sandbox it — so installation is the trust
  boundary and must be a deliberate user action (listed in a config file).
- Each plugin **declares the permissions it needs** (`read-telemetry`,
  `read-caveman`, `write-recommendations`, `serve-dashboard-panel`, …). The host
  grants only declared permissions and passes a capability object scoped to them;
  anything undeclared is absent, not merely discouraged.
- **Read-only Caveman** and **fail-open** apply transitively: a plugin is given
  read-only handles, and every host→plugin call is wrapped so a throw is logged and
  isolated, never propagated.

## Versioned interface

```ts
export interface ContextPilotPlugin {
  /** SDK contract version the plugin targets (semver). Host refuses a mismatch. */
  apiVersion: '1.x';
  id: string;
  name: string;
  permissions: Permission[];
  register(host: PluginHost): void | Promise<void>;
}
```

The host advertises `HOST_API_VERSION`; on load it checks semver compatibility and
refuses incompatible plugins with a clear diagnostic rather than loading them.

## Extension points (registered via `PluginHost`)

| Point | Host method | Shape |
|---|---|---|
| Agent adapter | `registerAgentAdapter` | `AgentAdapter` (already defined in `adapters/agent.ts`) |
| Optimizer adapter | `registerOptimizerAdapter` | `OptimizerAdapter` (`adapters/types.ts`) |
| Telemetry source | `registerTelemetrySource` | `{ pull(sinceMs): NormalizedEvent[] }` |
| Policy evaluator | `registerPolicy` | `Policy` (`policy/types.ts`) — code or declarative |
| Recommendation provider | `registerRecommender` | `(ctx) => Recommendation[]` |
| Exporter | `registerExporter` | `{ name, export(range): Buffer \| string }` |
| Dashboard panel | `registerPanel` | `{ title, route, render(): string }` (localhost only) |

Every registered function is invoked through an **isolation wrapper**:

```ts
function isolate<T>(pluginId: string, fn: () => T, fallback: T): T {
  try { return fn(); }
  catch (e) { recordPluginError(pluginId, e); return fallback; }
}
```

A plugin that throws is quarantined for the rest of the session and reported in
`contextpilot doctor`; its extension points fall back to empty results.

## Lifecycle & diagnostics

1. **Discover** — read `~/.context-pilot/plugins.json` (explicit list of module
   specifiers + granted permissions). Nothing else is loaded.
2. **Load** — `import()` each module, read its default-exported `ContextPilotPlugin`,
   check `apiVersion`, check declared permissions against the grant.
3. **Register** — call `register(host)` inside an isolation wrapper.
4. **Run** — host calls extension points through `isolate`.
5. **Diagnose** — `contextpilot plugins` lists id, version, permissions, health,
   and last error; `doctor` surfaces quarantined plugins.

## Why not ship interfaces now

The simplicity principle: single-implementation interfaces and unused extension
points are a cost with no current benefit. The first concrete need (e.g. a second
agent adapter, or an exporter) will be built against this contract, at which point
the `sdk/` module is extracted with exactly the surface that need requires. This
document is the commitment; the code follows the first real consumer.
