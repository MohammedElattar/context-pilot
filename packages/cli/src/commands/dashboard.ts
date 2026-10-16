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

async function handleApi(path: string): Promise<unknown> {
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
      const [sessions, tokens, tools, proxy, config] = await Promise.all([
        Promise.resolve(getSessions(10)),
        Promise.resolve(getTokenAgg()),
        Promise.resolve(getToolStats(10)),
        detectProxy(),
        Promise.resolve(loadConfig()),
      ]);
      return { sessions, tokens, tools, proxy, mode: config.mode };
    }
    default:
      return null;
  }
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
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
      try {
        const data = await handleApi(url.pathname);
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
    console.log(`  ${chalk.green('●')} http://127.0.0.1:${port}`);
    console.log(chalk.dim('  Press Ctrl+C to stop'));
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ContextPilot Dashboard</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --text-dim: #8b949e;
    --accent: #58a6ff;
    --green: #3fb950;
    --yellow: #d29922;
    --red: #f85149;
    --purple: #bc8cff;
    --radius: 8px;
    --gap: 16px;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --bg: #f6f8fa;
      --surface: #ffffff;
      --border: #d0d7de;
      --text: #1f2328;
      --text-dim: #656d76;
      --accent: #0969da;
      --green: #1a7f37;
      --yellow: #9a6700;
      --red: #cf222e;
      --purple: #8250df;
    }
  }
  :root[data-theme="dark"] {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --text-dim: #8b949e;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: var(--gap);
    max-width: 1200px;
    margin: 0 auto;
    line-height: 1.5;
  }
  h1 { font-size: 1.5rem; margin-bottom: var(--gap); }
  h1 span { color: var(--accent); }
  h2 { font-size: 1rem; color: var(--text-dim); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--gap); margin-bottom: var(--gap); }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--gap);
  }
  .stat { font-size: 2rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat-label { color: var(--text-dim); font-size: 0.85rem; }
  .stat-green { color: var(--green); }
  .stat-yellow { color: var(--yellow); }
  .stat-red { color: var(--red); }
  .stat-accent { color: var(--accent); }
  .stat-purple { color: var(--purple); }
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  th { text-align: left; color: var(--text-dim); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  td { padding: 6px 8px; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: none; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600;
  }
  .badge-green { background: color-mix(in srgb, var(--green) 20%, transparent); color: var(--green); }
  .badge-yellow { background: color-mix(in srgb, var(--yellow) 20%, transparent); color: var(--yellow); }
  .badge-red { background: color-mix(in srgb, var(--red) 20%, transparent); color: var(--red); }
  .badge-accent { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); }
  .bar-container { display: flex; gap: 2px; height: 20px; border-radius: 4px; overflow: hidden; }
  .bar-segment { height: 100%; min-width: 2px; }
  .empty { color: var(--text-dim); font-style: italic; padding: 20px; text-align: center; }
  .policy-item { padding: 8px 0; border-bottom: 1px solid var(--border); }
  .policy-item:last-child { border-bottom: none; }
  .policy-action { color: var(--text-dim); font-size: 0.85rem; }
  #status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .loading { color: var(--text-dim); }
  footer { text-align: center; padding: var(--gap); color: var(--text-dim); font-size: 0.8rem; }
</style>
</head>
<body>
<h1><span>ContextPilot</span> Dashboard</h1>

<div class="grid" id="stats-grid">
  <div class="card"><h2>Mode</h2><div class="stat loading" id="mode">...</div></div>
  <div class="card"><h2>Sessions</h2><div class="stat loading" id="session-count">...</div><div class="stat-label" id="session-label"></div></div>
  <div class="card"><h2>Output Tokens</h2><div class="stat stat-accent loading" id="output-tokens">...</div><div class="stat-label" id="token-label"></div></div>
  <div class="card"><h2>Cache Read</h2><div class="stat stat-green loading" id="cache-read">...</div><div class="stat-label" id="cache-ratio"></div></div>
  <div class="card"><h2>Proxy</h2><div class="stat loading" id="proxy-status">...</div><div class="stat-label" id="proxy-detail"></div></div>
</div>

<div class="grid">
  <div class="card">
    <h2>Tool Usage</h2>
    <table id="tool-table"><tbody><tr><td class="loading">Loading...</td></tr></tbody></table>
  </div>
  <div class="card">
    <h2>Recent Sessions</h2>
    <table id="session-table"><tbody><tr><td class="loading">Loading...</td></tr></tbody></table>
  </div>
</div>

<div class="grid">
  <div class="card">
    <h2>Caveman Sessions</h2>
    <div id="caveman-bar" style="margin-bottom:8px"></div>
    <table id="caveman-table"><tbody><tr><td class="loading">Loading...</td></tr></tbody></table>
  </div>
  <div class="card">
    <h2>Policy Evaluation</h2>
    <div id="policies-list"><div class="loading">Loading...</div></div>
  </div>
</div>

<footer>ContextPilot v0.1.0 &middot; Local-first &middot; All data stays on your machine</footer>

<script>
const fmt = n => {
  if (n == null) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return String(n);
};

const time = ms => {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
};

const dur = ms => {
  if (!ms) return '—';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s/60) + 'm ago';
  if (s < 86400) return Math.round(s/3600) + 'h ago';
  return Math.round(s/86400) + 'd ago';
};

async function load() {
  try {
    const [overview, caveman, policies] = await Promise.all([
      fetch('/api/overview').then(r => r.json()),
      fetch('/api/caveman').then(r => r.json()),
      fetch('/api/policies').then(r => r.json()),
    ]);

    // Stats
    const el = id => document.getElementById(id);
    el('mode').textContent = overview.mode || 'observe';
    el('mode').className = 'stat stat-accent';
    el('session-count').textContent = overview.sessions.length;
    el('session-count').className = 'stat';
    if (overview.sessions.length > 0) {
      el('session-label').textContent = 'Latest: ' + dur(overview.sessions[0].started_at);
    }

    const t = overview.tokens;
    el('output-tokens').textContent = fmt(t.total_output);
    el('output-tokens').className = 'stat stat-accent';
    el('token-label').textContent = fmt(t.total_input) + ' input · ' + fmt(t.snapshot_count) + ' snapshots';

    el('cache-read').textContent = fmt(t.total_cache_read);
    el('cache-read').className = 'stat stat-green';
    const total = t.total_input + t.total_cache_read;
    const ratio = total > 0 ? ((t.total_cache_read / total) * 100).toFixed(1) : '0';
    el('cache-ratio').textContent = ratio + '% cache hit ratio';

    el('proxy-status').textContent = overview.proxy.detected ? 'Active' : 'None';
    el('proxy-status').className = 'stat ' + (overview.proxy.detected ? 'stat-green' : 'stat-yellow');
    if (overview.proxy.detected) {
      el('proxy-detail').textContent = (overview.proxy.version || '') + ' · port ' + (overview.proxy.port || '?');
    }

    // Tool table
    const toolTbody = el('tool-table').querySelector('tbody') || el('tool-table');
    if (overview.tools.length === 0) {
      toolTbody.innerHTML = '<tr><td class="empty">No tool usage recorded</td></tr>';
    } else {
      toolTbody.innerHTML = '<tr><th>Tool</th><th>Calls</th><th>Avg ms</th></tr>' +
        overview.tools.map(t =>
          '<tr><td>' + esc(t.tool_name) + '</td><td>' + t.call_count +
          '</td><td>' + (t.avg_duration_ms != null ? Math.round(t.avg_duration_ms) : '—') + '</td></tr>'
        ).join('');
    }

    // Session table
    const sessTbody = el('session-table').querySelector('tbody') || el('session-table');
    if (overview.sessions.length === 0) {
      sessTbody.innerHTML = '<tr><td class="empty">No sessions recorded</td></tr>';
    } else {
      sessTbody.innerHTML = '<tr><th>Session</th><th>Events</th><th>When</th></tr>' +
        overview.sessions.slice(0, 10).map(s =>
          '<tr><td title="' + esc(s.id) + '">' + esc(s.id.slice(0,8)) + '…</td>' +
          '<td>' + s.event_count + '</td><td>' + dur(s.started_at) + '</td></tr>'
        ).join('');
    }

    // Caveman
    const caveHist = caveman.history || [];
    const caveTbody = el('caveman-table').querySelector('tbody') || el('caveman-table');
    if (caveHist.length === 0) {
      caveTbody.innerHTML = '<tr><td class="empty">No Caveman history</td></tr>';
      el('caveman-bar').innerHTML = '';
    } else {
      const totalOut = caveHist.reduce((s,h) => s + (h.output_tokens || 0), 0);
      const totalCache = caveHist.reduce((s,h) => s + (h.cache_read_input_tokens || 0), 0);
      const modes = {};
      caveHist.forEach(h => {
        if (h.mode) modes[h.mode] = (modes[h.mode]||0) + (h.output_tokens||0);
      });
      const modeColors = { ultracave:'#bc8cff', compress:'#58a6ff', normal:'#8b949e', passthrough:'#d29922' };
      const barMax = Math.max(...Object.values(modes));
      el('caveman-bar').innerHTML = '<div class="bar-container">' +
        Object.entries(modes).map(([m,v]) =>
          '<div class="bar-segment" style="flex:' + v + ';background:' + (modeColors[m]||'#8b949e') +
          '" title="' + m + ': ' + fmt(v) + ' tokens"></div>'
        ).join('') + '</div>' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:4px;font-size:0.75rem;color:var(--text-dim)">' +
        Object.entries(modes).map(([m,v]) =>
          '<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' +
          (modeColors[m]||'#8b949e') + ';margin-right:4px"></span>' + m + ' ' + fmt(v) + '</span>'
        ).join('') + '</div>';

      caveTbody.innerHTML = '<tr><th>Session</th><th>Mode</th><th>Output</th><th>Cache</th></tr>' +
        caveHist.slice(-10).reverse().map(h =>
          '<tr><td title="' + esc(h.session_id) + '">' + esc(h.session_id.slice(0,8)) + '…</td>' +
          '<td><span class="badge badge-accent">' + (h.mode||'?') + '</span></td>' +
          '<td>' + fmt(h.output_tokens) + '</td>' +
          '<td>' + fmt(h.cache_read_input_tokens || 0) + '</td></tr>'
        ).join('');
    }

    // Policies
    const polList = el('policies-list');
    const triggered = (policies.results || []).filter(p => p.triggered);
    if (triggered.length === 0) {
      polList.innerHTML = '<div style="padding:8px;color:var(--green)">&#10003; All policies pass</div>';
    } else {
      polList.innerHTML = triggered.map(p => {
        const cls = p.severity === 'critical' ? 'badge-red' : p.severity === 'warn' ? 'badge-yellow' : 'badge-accent';
        return '<div class="policy-item"><span class="badge ' + cls + '">' + esc(p.severity) +
          '</span> <strong>' + esc(p.name) + '</strong><div class="policy-action">' +
          esc(p.reason) + '<br>&rarr; ' + esc(p.action) + '</div></div>';
      }).join('');
    }
  } catch(e) {
    console.error('Dashboard load error:', e);
  }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

load();
setInterval(load, 30000);
</script>
</body>
</html>`;
