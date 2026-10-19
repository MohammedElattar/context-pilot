import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import {
  openReadOnly,
  paths,
  readCavemanHistory,
  readCavemanConfig,
  detectProxy,
  detectAllTools,
  detectConflicts,
  loadConfig,
  buildPolicyContext,
  evaluatePolicies,
  getSessionFileReads,
  getSessionFileWrites,
  getCavemanTokenStats,
  getCavemanSessionStats,
  getSessionCost,
  getResearchSummary,
  resetTelemetry,
} from '@contextpilot/core';
import type Database from 'better-sqlite3';

function queryDb<T>(fn: (db: Database.Database) => T, fallback: T): T {
  const dbPath = paths.contextPilot.db;
  if (!existsSync(dbPath)) return fallback;
  try {
    const db = openReadOnly(dbPath);
    const result = fn(db);
    db.close();
    return result;
  } catch {
    return fallback;
  }
}

function getSessions(limit: number) {
  return queryDb(db => db.prepare(`
    SELECT s.id, s.started_at, s.ended_at, s.model,
      COUNT(e.id) as event_count,
      (SELECT SUM(ts.output_tokens) FROM token_snapshots ts WHERE ts.session_id = s.id) as total_output_tokens,
      (SELECT SUM(ts.cache_read_tokens) FROM token_snapshots ts WHERE ts.session_id = s.id) as total_cache_read_tokens
    FROM sessions s LEFT JOIN events e ON e.session_id = s.id
    GROUP BY s.id ORDER BY s.started_at DESC LIMIT ?
  `).all(limit), []);
}

function getTokenAgg(sinceMs?: number) {
  return queryDb(db => {
    const w = sinceMs ? 'WHERE timestamp_ms >= ?' : '';
    const p = sinceMs ? [sinceMs] : [];
    return db.prepare(`
      SELECT COALESCE(SUM(input_tokens),0) as total_input,
             COALESCE(SUM(output_tokens),0) as total_output,
             COALESCE(SUM(cache_read_tokens),0) as total_cache_read,
             COALESCE(SUM(cache_write_tokens),0) as total_cache_write,
             COUNT(*) as snapshot_count
      FROM token_snapshots ${w}
    `).get(...p);
  }, { total_input: 0, total_output: 0, total_cache_read: 0, total_cache_write: 0, snapshot_count: 0 });
}

function getToolStats(limit: number) {
  return queryDb(db => db.prepare(`
    SELECT e.tool_name, COUNT(*) as call_count,
           COALESCE(SUM(e.payload_bytes),0) as total_payload_bytes,
           AVG(e.duration_ms) as avg_duration_ms
    FROM events e WHERE e.tool_name IS NOT NULL
    GROUP BY e.tool_name ORDER BY call_count DESC LIMIT ?
  `).all(limit), []);
}

function getEventTimeline() {
  return queryDb(db => db.prepare(`
    SELECT event_type, timestamp_ms, tool_name, duration_ms
    FROM events ORDER BY timestamp_ms DESC LIMIT 200
  `).all(), []);
}

async function handleApi(path: string, method: string): Promise<unknown> {
  if (path === '/api/reset') {
    if (method !== 'POST') return null;
    return { ok: true, removed: resetTelemetry() };
  }
  switch (path) {
    case '/api/sessions':
      return getSessions(50);
    case '/api/tokens':
      return getTokenAgg();
    case '/api/tokens/7d':
      return getTokenAgg(Date.now() - 7 * 86400000);
    case '/api/tools':
      return getToolStats(30);
    case '/api/timeline':
      return getEventTimeline();
    case '/api/caveman': {
      const [history, config, proxy] = await Promise.all([
        readCavemanHistory(),
        readCavemanConfig(),
        detectProxy(),
      ]);
      return { history: history.slice(-100), config, proxy };
    }
    case '/api/caveman-stats': {
      const stats = getCavemanTokenStats();
      const sessions = getCavemanSessionStats(10);
      return { stats, sessions };
    }
    case '/api/conflicts': {
      const [tools, detectedTools] = await Promise.all([
        detectAllTools(),
        detectAllTools(),
      ]);
      const conflicts = detectConflicts(tools);
      return { tools: detectedTools, conflicts };
    }
    case '/api/policies': {
      const config = loadConfig();
      const proxy = await detectProxy();
      const cavemanConfig = await readCavemanConfig();
      const ctx = buildPolicyContext({
        cavemanEnabled: proxy.detected,
        cavemanCompressingOutput: cavemanConfig !== null &&
          Array.isArray((cavemanConfig as any).modules) &&
          Object.values((cavemanConfig as any).modules || {}).includes(true),
        currentMode: config.mode,
      });
      return { context: ctx, results: evaluatePolicies(ctx) };
    }
    case '/api/overview': {
      const [sessions, tokens, tools, proxy, config, cavemanStats] = await Promise.all([
        Promise.resolve(getSessions(10)),
        Promise.resolve(getTokenAgg()),
        Promise.resolve(getToolStats(10)),
        detectProxy(),
        Promise.resolve(loadConfig()),
        Promise.resolve(getCavemanTokenStats()),
      ]);
      const cost = queryDb(db => {
        const row = db.prepare('SELECT id FROM sessions ORDER BY started_at DESC LIMIT 1').get() as any;
        if (!row?.id) return null;
        const c = getSessionCost(row.id, db);
        return {
          estimated: c.estimated ? { usd: c.estimated.usd, model: c.estimated.modelId, partial: c.estimated.partial, kind: 'estimated' } : null,
          billed: c.billed ? { usd: c.billed.usd, source: c.billed.source, kind: 'billed' } : null,
        };
      }, null);
      return { sessions, tokens, tools, proxy, mode: config.mode, cavemanStats, cost };
    }
    case '/api/file-reads': {
      const latestSession = queryDb(db => {
        const row = db.prepare('SELECT id FROM sessions ORDER BY started_at DESC LIMIT 1').get() as any;
        return row?.id ?? null;
      }, null);
      if (!latestSession) return { session_id: null, files: [] };
      return queryDb(db => ({
        session_id: latestSession,
        files: getSessionFileReads(latestSession, db),
      }), { session_id: latestSession, files: [] });
    }
    case '/api/file-writes': {
      const latestSession2 = queryDb(db => {
        const row = db.prepare('SELECT id FROM sessions ORDER BY started_at DESC LIMIT 1').get() as any;
        return row?.id ?? null;
      }, null);
      if (!latestSession2) return { session_id: null, files: [] };
      return queryDb(db => ({
        session_id: latestSession2,
        files: getSessionFileWrites(latestSession2, db),
      }), { session_id: latestSession2, files: [] });
    }
    case '/api/research':
      // null = aggregate across all sessions (gateway calls span sessions).
      return queryDb(db => getResearchSummary(null, db), {
        session_id: null, routed_calls: 0, searched: 0, cache_hits: 0, deduplicated: 0, failed_calls: 0,
        est_tokens_in: 0, est_tokens_out: 0, est_tokens_saved: 0, cache_hit_rate: 0,
        bypassed_native_calls: 0, routing_adoption_rate: null,
      });
    default:
      return null;
  }
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  // No wildcard CORS: the dashboard is same-origin, and telemetry should not be
  // readable by other origins. The server also binds loopback only.
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/;

/**
 * Guard state-changing requests against cross-site/DNS-rebinding abuse: the
 * Host must be loopback, and any Origin header must also be loopback.
 */
function isLoopbackRequest(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host || !LOOPBACK.test(host.replace(/:\d+$/, ''))) return false;
  const origin = req.headers.origin;
  if (origin) {
    try { return LOOPBACK.test(new URL(origin).hostname); } catch { return false; }
  }
  return true;
}

function sendHtml(res: ServerResponse, html: string) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

export async function runDashboard(opts: { port?: string }) {
  const port = parseInt(opts.port || '3141', 10);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    if (url.pathname.startsWith('/api/')) {
      // State-changing endpoints require a loopback, same-origin request.
      if (req.method === 'POST' && !isLoopbackRequest(req)) {
        sendJson(res, { error: 'Forbidden: cross-origin state change rejected.' }, 403);
        return;
      }
      try {
        const data = await handleApi(url.pathname, req.method || 'GET');
        if (data === null) {
          sendJson(res, { error: 'Not found' }, 404);
        } else {
          sendJson(res, data);
        }
      } catch (err) {
        sendJson(res, { error: err instanceof Error ? err.message : 'Internal error' }, 500);
      }
      return;
    }

    sendHtml(res, DASHBOARD_HTML);
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(chalk.bold('ContextPilot Dashboard'));
    console.log(`  ${chalk.green('\u25cf')} http://127.0.0.1:${port}`);
    console.log(chalk.dim('  Press Ctrl+C to stop'));
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ContextPilot</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>
:root {
  --bg: #f8f9fb;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --border: #e2e5ea;
  --border-subtle: #eef0f3;
  --fg: #1a1d23;
  --fg-dim: #6b7280;
  --fg-muted: #9ca3af;
  --accent: #0d9488;
  --accent-soft: #ccfbf1;
  --accent-text: #0f766e;
  --good: #059669;
  --good-soft: #d1fae5;
  --warn: #d97706;
  --warn-soft: #fef3c7;
  --crit: #dc2626;
  --crit-soft: #fee2e2;
  --purple: #7c3aed;
  --purple-soft: #ede9fe;
  --font-display: 'DM Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  --radius: 10px;
  --radius-sm: 6px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f1117;
    --surface: #181b23;
    --surface-raised: #1e222c;
    --border: #2a2e3a;
    --border-subtle: #22262f;
    --fg: #e4e7ec;
    --fg-dim: #8b92a0;
    --fg-muted: #5c6370;
    --accent: #2dd4bf;
    --accent-soft: rgba(45,212,191,0.12);
    --accent-text: #5eead4;
    --good: #34d399;
    --good-soft: rgba(52,211,153,0.12);
    --warn: #fbbf24;
    --warn-soft: rgba(251,191,36,0.12);
    --crit: #f87171;
    --crit-soft: rgba(248,113,113,0.12);
    --purple: #a78bfa;
    --purple-soft: rgba(167,139,250,0.12);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0f1117;
  --surface: #181b23;
  --surface-raised: #1e222c;
  --border: #2a2e3a;
  --border-subtle: #22262f;
  --fg: #e4e7ec;
  --fg-dim: #8b92a0;
  --fg-muted: #5c6370;
  --accent: #2dd4bf;
  --accent-soft: rgba(45,212,191,0.12);
  --accent-text: #5eead4;
  --good: #34d399;
  --good-soft: rgba(52,211,153,0.12);
  --warn: #fbbf24;
  --warn-soft: rgba(251,191,36,0.12);
  --crit: #f87171;
  --crit-soft: rgba(248,113,113,0.12);
  --purple: #a78bfa;
  --purple-soft: rgba(167,139,250,0.12);
  color-scheme: dark;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-display);
  padding: 0 16px;
  max-width: 1120px;
  margin: 0 auto;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 0 16px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}
.header-left { display: flex; align-items: center; gap: 12px; }
.logo { font-size: 1.125rem; font-weight: 700; letter-spacing: -0.02em; color: var(--fg); }
.logo-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; background: var(--accent); color: #fff;
  border-radius: 7px; font-family: var(--font-mono); font-size: 0.75rem;
  font-weight: 600; margin-right: 8px; vertical-align: middle;
}
.header-meta { display: flex; align-items: center; gap: 16px; font-size: 0.8125rem; color: var(--fg-dim); }
.status-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 20px; font-size: 0.75rem;
  font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase;
}
.status-pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; }
.pill-active { background: var(--good-soft); color: var(--good); }
.pill-active::before { background: var(--good); }
.pill-mode { background: var(--accent-soft); color: var(--accent-text); }
.pill-mode::before { background: var(--accent); }
.refresh-text { font-size: 0.75rem; color: var(--fg-muted); font-variant-numeric: tabular-nums; }
.metrics {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 12px; margin-bottom: 24px;
}
@media (max-width: 720px) { .metrics { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 440px) { .metrics { grid-template-columns: 1fr; } }
.metric {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px 18px;
  display: flex; flex-direction: column; gap: 4px; min-width: 0;
}
.metric-label {
  font-size: 0.6875rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--fg-muted);
}
.metric-value {
  font-family: var(--font-mono); font-size: 1.75rem; font-weight: 600;
  line-height: 1.1; letter-spacing: -0.03em; font-variant-numeric: tabular-nums;
}
.metric-sub { font-size: 0.75rem; color: var(--fg-dim); margin-top: 2px; }
.val-accent { color: var(--accent-text); }
.val-good { color: var(--good); }
.val-warn { color: var(--warn); }
.val-crit { color: var(--crit); }
.gauge { margin-top: 6px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
.gauge-fill {
  height: 100%; border-radius: 3px;
  background: linear-gradient(90deg, var(--accent), var(--good));
  transition: width 0.6s ease;
}
.grid-2 {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 12px; margin-bottom: 24px;
}
@media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }
.panel {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden; min-width: 0;
}
.panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border-subtle);
}
.panel-title { font-size: 0.8125rem; font-weight: 600; color: var(--fg); }
.panel-badge {
  font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 500;
  color: var(--fg-dim); background: var(--bg); padding: 2px 8px; border-radius: 4px;
}
.data-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
.data-table th {
  text-align: left; font-size: 0.6875rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.04em; color: var(--fg-muted);
  padding: 8px 16px; border-bottom: 1px solid var(--border-subtle); background: var(--bg);
}
.data-table td {
  padding: 8px 16px; border-bottom: 1px solid var(--border-subtle);
  font-variant-numeric: tabular-nums; color: var(--fg);
}
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--bg); }
.data-table .mono { font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: -0.01em; }
.data-table .dim { color: var(--fg-dim); }
.data-table .num { text-align: right; font-family: var(--font-mono); font-size: 0.75rem; }
.data-table th.num { text-align: right; }
.empty-state { padding: 32px 16px; text-align: center; color: var(--fg-muted); font-size: 0.8125rem; }
.mode-bar { display: flex; gap: 2px; height: 8px; border-radius: 4px; overflow: hidden; margin: 12px 16px 8px; }
.mode-segment { height: 100%; min-width: 3px; border-radius: 2px; }
.mode-legend {
  display: flex; flex-wrap: wrap; gap: 12px;
  padding: 0 16px 12px; font-size: 0.6875rem; color: var(--fg-dim);
}
.mode-legend-dot {
  display: inline-block; width: 8px; height: 8px;
  border-radius: 2px; margin-right: 4px; vertical-align: middle;
}
.policy-list { padding: 4px 0; }
.policy-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 16px; border-bottom: 1px solid var(--border-subtle);
}
.policy-item:last-child { border-bottom: none; }
.severity-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
.severity-warn { background: var(--warn); }
.severity-crit { background: var(--crit); }
.severity-info { background: var(--accent); }
.policy-text { font-size: 0.8125rem; line-height: 1.4; }
.policy-name { font-weight: 600; }
.policy-reason { color: var(--fg-dim); font-size: 0.75rem; margin-top: 2px; }
.footer { text-align: center; padding: 24px 0 16px; font-size: 0.6875rem; color: var(--fg-muted); letter-spacing: 0.02em; }
.btn-reset {
  font-family: var(--font-display); font-size: 0.75rem; font-weight: 600;
  color: var(--fg-dim); background: var(--surface); border: 1px solid var(--border);
  padding: 4px 12px; border-radius: var(--radius-sm); cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.btn-reset:hover { color: var(--crit); border-color: var(--crit); }
.btn-reset:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="logo"><span class="logo-mark">CP</span>ContextPilot</div>
    <span class="status-pill pill-mode" id="mode-pill">observe</span>
    <span class="status-pill pill-active" id="proxy-pill">proxy active</span>
  </div>
  <div class="header-meta">
    <span id="proxy-detail"></span>
    <span class="refresh-text" id="refresh-indicator"></span>
    <button class="btn-reset" id="reset-btn" title="Clear ContextPilot telemetry and start fresh">Reset</button>
  </div>
</div>

<div class="metrics">
  <div class="metric">
    <span class="metric-label">Requests</span>
    <span class="metric-value" id="m-requests">...</span>
    <span class="metric-sub" id="m-requests-sub"></span>
  </div>
  <div class="metric">
    <span class="metric-label">Input Tokens</span>
    <span class="metric-value val-accent" id="m-input">...</span>
    <span class="metric-sub" id="m-input-sub"></span>
  </div>
  <div class="metric">
    <span class="metric-label">Output Tokens</span>
    <span class="metric-value" id="m-output">...</span>
    <span class="metric-sub" id="m-output-sub"></span>
  </div>
  <div class="metric">
    <span class="metric-label">Cache Hit Ratio</span>
    <span class="metric-value val-good" id="m-cache">...</span>
    <div class="gauge"><div class="gauge-fill" id="gauge-fill" style="width:0%"></div></div>
    <span class="metric-sub" id="m-cache-sub"></span>
  </div>
</div>

<div class="grid-2">
  <div class="panel">
    <div class="panel-header"><span class="panel-title">Sessions</span><span class="panel-badge" id="session-badge">0</span></div>
    <div style="overflow-x:auto">
      <table class="data-table"><thead><tr><th>Session</th><th>Model</th><th class="num">Reqs</th><th class="num">Output</th><th class="num">Cached</th></tr></thead>
      <tbody id="session-tbody"><tr><td colspan="5" class="empty-state">Loading...</td></tr></tbody></table>
    </div>
  </div>
  <div class="panel">
    <div class="panel-header"><span class="panel-title">Tool Usage</span><span class="panel-badge" id="tool-badge">0</span></div>
    <div style="overflow-x:auto">
      <table class="data-table"><thead><tr><th>Tool</th><th class="num">Calls</th><th class="num">Avg ms</th><th class="num">Payload</th></tr></thead>
      <tbody id="tool-tbody"><tr><td colspan="4" class="empty-state">Loading...</td></tr></tbody></table>
    </div>
  </div>
</div>

<div class="grid-2">
  <div class="panel">
    <div class="panel-header"><span class="panel-title">File Reads</span><span class="panel-badge">latest session</span></div>
    <div style="overflow-x:auto">
      <table class="data-table"><thead><tr><th>File</th><th class="num">Reads</th><th class="num">Bytes</th></tr></thead>
      <tbody id="fr-tbody"><tr><td colspan="3" class="empty-state">Loading...</td></tr></tbody></table>
    </div>
  </div>
  <div class="panel">
    <div class="panel-header"><span class="panel-title">File Writes</span><span class="panel-badge">latest session</span></div>
    <div style="overflow-x:auto">
      <table class="data-table"><thead><tr><th>File</th><th class="num">Writes</th><th>Tools</th></tr></thead>
      <tbody id="fw-tbody"><tr><td colspan="3" class="empty-state">Loading...</td></tr></tbody></table>
    </div>
  </div>
</div>

<div class="grid-2">
  <div class="panel">
    <div class="panel-header"><span class="panel-title">Caveman Modes</span></div>
    <div id="mode-bar-container"></div>
    <div style="overflow-x:auto">
      <table class="data-table"><thead><tr><th>Session</th><th>Mode</th><th class="num">Output</th><th class="num">Cache</th></tr></thead>
      <tbody id="caveman-tbody"><tr><td colspan="4" class="empty-state">Loading...</td></tr></tbody></table>
    </div>
  </div>
  <div class="panel">
    <div class="panel-header"><span class="panel-title">Policies</span></div>
    <div id="policies-container"><div class="empty-state">Loading...</div></div>
  </div>
</div>

<div class="panel">
  <div class="panel-header"><span class="panel-title">Research Gateway</span><span class="panel-badge" id="research-badge">0 routed</span></div>
  <div id="research-container"><div class="empty-state">Loading...</div></div>
</div>

<div class="footer">ContextPilot v0.1.0 &middot; Local-first &middot; All data on your machine</div>

<script>
var fmt = function(n) {
  if (n == null) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return String(Math.round(n));
};
var pct = function(n) { return n != null ? (n * 100).toFixed(1) + '%' : '0%'; };
var esc = function(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
var dur = function(ms) {
  if (!ms) return '\\u2014';
  var s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s/60) + 'm ago';
  if (s < 86400) return Math.round(s/3600) + 'h ago';
  return Math.round(s/86400) + 'd ago';
};
var el = function(id) { return document.getElementById(id); };
var modeColors = { ultracave:'#7c3aed', caveman:'#7c3aed', compress:'#0d9488', normal:'#6b7280', passthrough:'#d97706' };

function tryFetch(url) {
  return fetch(url).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
}

function load() {
  Promise.all([
    tryFetch('/api/overview'),
    tryFetch('/api/caveman-stats'),
    tryFetch('/api/caveman'),
    tryFetch('/api/policies'),
    tryFetch('/api/file-reads'),
    tryFetch('/api/file-writes'),
    tryFetch('/api/research'),
  ]).then(function(results) {
    var overview = results[0], cavemanStats = results[1], caveman = results[2];
    var policies = results[3], fileReads = results[4], fileWrites = results[5];
    var research = results[6];

    if (research) {
      el('research-badge').textContent = (research.routed_calls || 0) + ' routed';
      var adopt = research.routing_adoption_rate;
      var rows = [
        ['Routed via gateway', research.routed_calls || 0],
        ['Searches (contextpilot_search)', research.searched || 0],
        ['Bypassed (native WebFetch/WebSearch)', research.bypassed_native_calls || 0],
        ['Routing adoption', adopt != null ? pct(adopt) : '\\u2014'],
        ['Cache hit rate', pct(research.cache_hit_rate || 0)],
        ['Failed calls', research.failed_calls || 0],
        ['Est. tokens saved (within-gateway trim)', fmt(research.est_tokens_saved || 0)],
      ];
      var html = '<table class="data-table"><tbody>';
      for (var i = 0; i < rows.length; i++) {
        html += '<tr><td>' + esc(rows[i][0]) + '</td><td class="num">' + esc(String(rows[i][1])) + '</td></tr>';
      }
      html += '</tbody></table>';
      el('research-container').innerHTML = (research.routed_calls || research.bypassed_native_calls)
        ? html : '<div class="empty-state">No research activity yet.</div>';
    }

    if (overview) {
      el('mode-pill').textContent = overview.mode || 'observe';
      var proxy = overview.proxy || {};
      if (proxy.detected) {
        el('proxy-pill').textContent = 'proxy active';
        el('proxy-pill').className = 'status-pill pill-active';
        el('proxy-detail').textContent = (proxy.version || '') + ' \\u00b7 port ' + (proxy.port || '?');
      } else {
        el('proxy-pill').textContent = 'no proxy';
        el('proxy-pill').className = 'status-pill';
        el('proxy-pill').style.background = 'var(--warn-soft)';
        el('proxy-pill').style.color = 'var(--warn)';
      }
    }

    var cs = (cavemanStats && cavemanStats.stats) || (overview && overview.cavemanStats);
    if (cs) {
      el('m-requests').textContent = fmt(cs.totalRequests);
      el('m-requests-sub').textContent = 'via Caveman proxy';
      el('m-input').textContent = fmt(cs.inputTokens);
      el('m-input-sub').textContent = fmt(cs.cachedInputTokens) + ' from cache';
      el('m-output').textContent = fmt(cs.outputTokens);
      el('m-output-sub').textContent = fmt(cs.cacheCreationTokens) + ' cache writes';
      var ratio = cs.cacheHitRatio != null ? cs.cacheHitRatio : 0;
      el('m-cache').textContent = pct(ratio);
      el('m-cache').className = 'metric-value ' + (ratio > 0.8 ? 'val-good' : ratio > 0.5 ? 'val-warn' : 'val-crit');
      el('gauge-fill').style.width = (ratio * 100) + '%';
      el('m-cache-sub').textContent = fmt(cs.cachedInputTokens) + ' of ' + fmt(cs.inputTokens) + ' input';
    } else if (overview) {
      var t = overview.tokens;
      el('m-requests').textContent = overview.sessions ? overview.sessions.length : 0;
      el('m-requests-sub').textContent = 'sessions';
      el('m-input').textContent = fmt(t.total_input);
      el('m-output').textContent = fmt(t.total_output);
      var total = t.total_input + t.total_cache_read;
      var r = total > 0 ? t.total_cache_read / total : 0;
      el('m-cache').textContent = (r * 100).toFixed(1) + '%';
      el('gauge-fill').style.width = (r * 100) + '%';
    }

    var sessions = (cavemanStats && cavemanStats.sessions) || [];
    el('session-badge').textContent = sessions.length + ' sessions';
    if (sessions.length === 0) {
      el('session-tbody').innerHTML = '<tr><td colspan="5" class="empty-state">No session data</td></tr>';
    } else {
      el('session-tbody').innerHTML = sessions.map(function(s) {
        var sid = (s.sessionId || '').replace('claude:', '');
        return '<tr><td class="mono">' + esc(sid.slice(0,12)) + '\\u2026</td>' +
          '<td class="dim" style="font-size:0.75rem">' + esc(s.model || '\\u2014') + '</td>' +
          '<td class="num">' + s.requests + '</td>' +
          '<td class="num">' + fmt(s.outputTokens) + '</td>' +
          '<td class="num">' + fmt(s.cachedInputTokens) + '</td></tr>';
      }).join('');
    }

    var tools = (overview && overview.tools) || [];
    el('tool-badge').textContent = tools.length + ' tools';
    if (tools.length === 0) {
      el('tool-tbody').innerHTML = '<tr><td colspan="4" class="empty-state">No tool usage recorded</td></tr>';
    } else {
      el('tool-tbody').innerHTML = tools.map(function(t) {
        return '<tr><td class="mono">' + esc(t.tool_name) + '</td>' +
          '<td class="num">' + t.call_count + '</td>' +
          '<td class="num">' + (t.avg_duration_ms != null ? Math.round(t.avg_duration_ms) : '\\u2014') + '</td>' +
          '<td class="num">' + fmt(t.total_payload_bytes) + '</td></tr>';
      }).join('');
    }

    var frFiles = (fileReads && fileReads.files) || [];
    if (frFiles.length === 0) {
      el('fr-tbody').innerHTML = '<tr><td colspan="3" class="empty-state">No file reads recorded</td></tr>';
    } else {
      el('fr-tbody').innerHTML = frFiles.slice(0, 12).map(function(f) {
        return '<tr><td class="mono" title="' + esc(f.file_path) + '">' + esc(f.file_path.split('/').pop() || f.file_path) +
          '</td><td class="num">' + f.read_count + '</td><td class="num">' + fmt(f.total_payload_bytes) + '</td></tr>';
      }).join('');
    }

    var fwFiles = (fileWrites && fileWrites.files) || [];
    if (fwFiles.length === 0) {
      el('fw-tbody').innerHTML = '<tr><td colspan="3" class="empty-state">No file writes recorded</td></tr>';
    } else {
      el('fw-tbody').innerHTML = fwFiles.slice(0, 12).map(function(f) {
        return '<tr><td class="mono" title="' + esc(f.file_path) + '">' + esc(f.file_path.split('/').pop() || f.file_path) +
          '</td><td class="num">' + f.write_count + '</td><td class="dim">' + esc(f.tools_used) + '</td></tr>';
      }).join('');
    }

    var caveHist = (caveman && caveman.history) || [];
    var container = el('mode-bar-container');
    if (caveHist.length === 0) {
      container.innerHTML = '';
      el('caveman-tbody').innerHTML = '<tr><td colspan="4" class="empty-state">No Caveman history</td></tr>';
    } else {
      var modes = {};
      caveHist.forEach(function(h) { if (h.mode) modes[h.mode] = (modes[h.mode]||0) + (h.output_tokens||0); });
      container.innerHTML =
        '<div class="mode-bar">' +
        Object.entries(modes).map(function(e) {
          return '<span class="mode-segment" style="flex:' + e[1] + ';background:' + (modeColors[e[0]]||'#6b7280') + '" title="' + e[0] + ': ' + fmt(e[1]) + '"></span>';
        }).join('') + '</div>' +
        '<div class="mode-legend">' +
        Object.entries(modes).map(function(e) {
          return '<span><span class="mode-legend-dot" style="background:' + (modeColors[e[0]]||'#6b7280') + '"></span>' + e[0] + ' ' + fmt(e[1]) + '</span>';
        }).join('') + '</div>';

      el('caveman-tbody').innerHTML = caveHist.slice(-8).reverse().map(function(h) {
        return '<tr><td class="mono">' + esc((h.session_id||'').slice(0,12)) + '\\u2026</td>' +
          '<td><span style="display:inline-block;padding:1px 8px;border-radius:4px;font-size:0.6875rem;font-weight:600;background:' +
          (modeColors[h.mode]||'#6b7280') + '20;color:' + (modeColors[h.mode]||'#6b7280') + '">' + (h.mode||'?') + '</span></td>' +
          '<td class="num">' + fmt(h.output_tokens) + '</td>' +
          '<td class="num">' + fmt(h.cache_read_input_tokens || 0) + '</td></tr>';
      }).join('');
    }

    var polContainer = el('policies-container');
    var triggered = ((policies && policies.results) || []).filter(function(p) { return p.triggered; });
    if (triggered.length === 0) {
      polContainer.innerHTML = '<div style="padding:24px 16px;text-align:center;color:var(--good);font-size:0.8125rem;font-weight:500">\\u2713 All policies pass</div>';
    } else {
      polContainer.innerHTML = '<div class="policy-list">' + triggered.map(function(p) {
        var cls = p.severity === 'critical' ? 'severity-crit' : p.severity === 'warn' ? 'severity-warn' : 'severity-info';
        return '<div class="policy-item"><div class="severity-dot ' + cls + '"></div><div class="policy-text">' +
          '<div class="policy-name">' + esc(p.name) + '</div>' +
          '<div class="policy-reason">' + esc(p.reason) + ' \\u2192 ' + esc(p.action) + '</div></div></div>';
      }).join('') + '</div>';
    }
  }).catch(function(e) { console.error('Dashboard load error:', e); });
}

var resetBtn = el('reset-btn');
if (resetBtn) {
  resetBtn.addEventListener('click', function() {
    if (!confirm('Clear all ContextPilot telemetry? This cannot be undone. Caveman data is not affected.')) return;
    resetBtn.disabled = true;
    resetBtn.textContent = 'Resetting\\u2026';
    fetch('/api/reset', { method: 'POST' }).then(function(r) { return r.ok ? r.json() : null; }).then(function(res) {
      resetBtn.disabled = false;
      resetBtn.textContent = res && res.ok ? 'Reset \\u2713' : 'Reset failed';
      countdown = 30;
      load();
      setTimeout(function() { resetBtn.textContent = 'Reset'; }, 2000);
    }).catch(function() {
      resetBtn.disabled = false;
      resetBtn.textContent = 'Reset failed';
    });
  });
}

var countdown = 30;
function tick() {
  var ind = el('refresh-indicator');
  if (ind) ind.textContent = 'refresh in ' + countdown + 's';
  countdown--;
  if (countdown < 0) { countdown = 30; load(); }
}
load();
setInterval(tick, 1000);
</script>
</body>
</html>`;
