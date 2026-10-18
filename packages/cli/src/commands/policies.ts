import { existsSync, readFileSync } from 'node:fs';
import chalk from 'chalk';
import {
  buildPolicyContext,
  getTriggeredPolicies,
  evaluatePolicies,
  evaluateAllPolicies,
  loadDeclarativePolicies,
  validateDeclarativePolicies,
  ALL_POLICIES,
  detectProxy,
  readCavemanConfig,
  loadConfig,
  openReadOnly,
  paths,
  getRepeatedFileReadCount,
  estimateContextWindowUsage,
  getCacheReadRatio,
  type PolicyContext,
} from '@contextpilot/core';
import type Database from 'better-sqlite3';
import { printSection } from '../formatters/table.js';

interface PolicyOptions { json?: boolean }

const VALID = ['evaluate', 'validate', 'explain', 'simulate'] as const;

export async function runPolicies(action: string | undefined, id: string | undefined, opts: PolicyOptions) {
  const act = action ?? 'evaluate';
  if (!VALID.includes(act as any)) {
    console.error(`Unknown policies action '${action}'. Use: ${VALID.join(' | ')}`);
    process.exit(1);
  }
  if (act === 'validate') return validate(opts);
  if (act === 'explain') return explain(id, opts);
  if (act === 'simulate') return simulate(opts);
  return evaluate(opts);
}

async function currentContext(): Promise<{ ctx: PolicyContext; mode: string; cavemanEnabled: boolean; toolCallCount: number; sessionTurns: number }> {
  const [proxy, cavemanConfig, config] = await Promise.all([
    detectProxy(),
    readCavemanConfig(),
    Promise.resolve(loadConfig()),
  ]);

  let sessionTurns = 0, toolCallCount = 0, repeatedFileReads = 0;
  if (existsSync(paths.contextPilot.db)) {
    try {
      const db = openReadOnly(paths.contextPilot.db);
      const latest = db.prepare('SELECT id FROM sessions ORDER BY started_at DESC LIMIT 1').get() as any;
      if (latest?.id) {
        sessionTurns = (db.prepare('SELECT COUNT(*) as c FROM events WHERE session_id = ?').get(latest.id) as any)?.c ?? 0;
        toolCallCount = (db.prepare('SELECT COUNT(*) as c FROM events WHERE session_id = ? AND tool_name IS NOT NULL').get(latest.id) as any)?.c ?? 0;
        repeatedFileReads = getRepeatedFileReadCount(latest.id, 1, db);
      }
      db.close();
    } catch { /* telemetry unavailable */ }
  }

  const cavemanEnabled = proxy.detected;
  const cavemanCompressingOutput = cavemanConfig !== null && Array.isArray((cavemanConfig as any).modules) &&
    (cavemanConfig as any).modules.includes('output');

  const ctx = buildPolicyContext({ sessionTurns, toolCallCount, repeatedFileReads, cavemanEnabled, cavemanCompressingOutput, currentMode: config.mode });
  return { ctx, mode: config.mode, cavemanEnabled, toolCallCount, sessionTurns };
}

async function evaluate(opts: PolicyOptions) {
  const { ctx, mode, cavemanEnabled, toolCallCount, sessionTurns } = await currentContext();
  const allResults = evaluateAllPolicies(ctx); // code + declarative
  const triggered = allResults.filter(r => r.triggered);

  if (opts.json) {
    console.log(JSON.stringify({ context: ctx, results: allResults, triggered }, null, 2));
    return;
  }

  printSection('Policy Evaluation', []);
  console.log(chalk.dim('  Context:'));
  console.log(`    Mode: ${mode}`);
  console.log(`    Caveman: ${cavemanEnabled ? 'enabled' : 'not detected'}`);
  console.log(`    Tool calls: ${toolCallCount}`);
  console.log(`    Session turns: ${sessionTurns}`);
  console.log();

  if (triggered.length === 0) {
    console.log(chalk.green('  ✓ All policies pass. No action needed.'));
  } else {
    for (const r of triggered) {
      const icon = r.severity === 'critical' ? chalk.red('✗') : r.severity === 'warn' ? chalk.yellow('!') : chalk.blue('i');
      const conf = r.confidence != null ? chalk.dim(` [confidence ${(r.confidence * 100).toFixed(0)}%]`) : '';
      console.log(`  ${icon} ${chalk.bold(r.name)}${conf}`);
      console.log(`    ${r.reason}`);
      console.log(`    ${chalk.dim('→')} ${r.action}`);
      console.log();
    }
  }
  console.log(chalk.dim(`  ${allResults.length} policies evaluated, ${triggered.length} triggered`));
}

function validate(opts: PolicyOptions) {
  const file = paths.contextPilot.policies;
  if (!existsSync(file)) {
    const msg = { ok: true, count: 0, errors: [], note: `No declarative policy file at ${file}` };
    console.log(opts.json ? JSON.stringify(msg, null, 2) : chalk.dim(`  No declarative policy file at ${file} (built-in policies still apply).`));
    return;
  }
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf-8')); }
  catch (e) {
    const r = { ok: false, count: 0, errors: [`invalid JSON: ${(e as Error).message}`] };
    console.log(opts.json ? JSON.stringify(r, null, 2) : chalk.red(`  ✗ ${r.errors[0]}`));
    process.exitCode = 1;
    return;
  }
  const result = validateDeclarativePolicies(raw);
  if (opts.json) { console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; return; }
  printSection('Policy Validation', []);
  if (result.ok) console.log(chalk.green(`  ✓ ${result.count} declarative policy(ies) valid.`));
  else { console.log(chalk.red(`  ✗ ${result.errors.length} error(s):`)); for (const e of result.errors) console.log(`    - ${e}`); process.exitCode = 1; }
}

async function explain(id: string | undefined, opts: PolicyOptions) {
  if (!id) { console.error('Usage: context-pilot policies explain <id>'); process.exit(1); }
  const policies = [...ALL_POLICIES, ...loadDeclarativePolicies()];
  const policy = policies.find(p => p.id === id);
  if (!policy) {
    const known = policies.map(p => p.id).join(', ');
    console.error(`Unknown policy '${id}'. Known: ${known}`);
    process.exit(1);
  }
  const { ctx } = await currentContext();
  const result = policy.evaluate(ctx);
  if (opts.json) { console.log(JSON.stringify({ id, result, context: ctx }, null, 2)); return; }
  printSection(`Policy: ${result.name}`, []);
  console.log(`  Id: ${result.id}`);
  console.log(`  Triggered now: ${result.triggered ? chalk.yellow('yes') : chalk.green('no')}`);
  console.log(`  Severity: ${result.severity}`);
  if (result.confidence != null) console.log(`  Confidence: ${(result.confidence * 100).toFixed(0)}%`);
  console.log(`  Reason: ${result.reason}`);
  console.log(`  Action: ${result.action}`);
}

function simulate(opts: PolicyOptions) {
  const declarative = loadDeclarativePolicies();
  const rows: { session_id: string; triggered: string[] }[] = [];

  if (existsSync(paths.contextPilot.db)) {
    try {
      const db: Database.Database = openReadOnly(paths.contextPilot.db);
      const sessions = db.prepare('SELECT id FROM sessions ORDER BY started_at DESC LIMIT 20').all() as { id: string }[];
      for (const s of sessions) {
        const toolCallCount = (db.prepare('SELECT COUNT(*) as c FROM events WHERE session_id = ? AND tool_name IS NOT NULL').get(s.id) as any)?.c ?? 0;
        const ctx = buildPolicyContext({
          toolCallCount,
          repeatedFileReads: getRepeatedFileReadCount(s.id, 1, db),
          contextWindowUsedPercent: estimateContextWindowUsage(s.id, db) ?? undefined,
          cacheReadRatio: getCacheReadRatio(s.id, db) ?? undefined,
        });
        const triggered = evaluateAllPolicies(ctx, declarative).filter(r => r.triggered).map(r => r.id);
        rows.push({ session_id: s.id, triggered });
      }
      db.close();
    } catch { /* unavailable */ }
  }

  if (opts.json) { console.log(JSON.stringify({ dry_run: true, sessions: rows }, null, 2)); return; }
  printSection('Policy Simulation (dry-run, no changes applied)', []);
  if (rows.length === 0) { console.log(chalk.dim('  No sessions to simulate against.')); return; }
  for (const r of rows) {
    const label = r.triggered.length ? chalk.yellow(r.triggered.join(', ')) : chalk.green('none');
    console.log(`  ${chalk.dim(r.session_id.slice(0, 8))} → ${label}`);
  }
  const totalTriggers = rows.reduce((s, r) => s + r.triggered.length, 0);
  console.log(chalk.dim(`\n  ${rows.length} sessions, ${totalTriggers} total triggers. Nothing was changed.`));
}
