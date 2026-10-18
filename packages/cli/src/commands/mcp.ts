import chalk from 'chalk';
import {
  detectPlugins,
  detectConflicts,
  profileMcpServers,
  profileMcpTools,
  type McpToolProfile,
} from '@contextpilot/core';

interface McpOptions {
  json?: boolean;
  days?: string;
}

const VALID = ['list', 'profile', 'inspect', 'conflicts'] as const;
type Action = typeof VALID[number];

export async function runMcp(action: string | undefined, server: string | undefined, options: McpOptions): Promise<void> {
  const act = (action ?? 'list') as Action;
  if (!VALID.includes(act)) {
    console.error(`Unknown mcp action '${action}'. Use: ${VALID.join(' | ')}`);
    process.exit(1);
  }

  const days = parseInt(options.days ?? '7', 10);
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  if (act === 'list') return list(options);
  if (act === 'conflicts') return conflicts(options);
  if (act === 'inspect') return inspect(server, sinceMs, options);
  return profile(sinceMs, options);
}

async function list(options: McpOptions): Promise<void> {
  const report = await detectPlugins();
  if (options.json) {
    console.log(JSON.stringify(report.mcpServers, null, 2));
    return;
  }
  console.log();
  console.log(chalk.bold.underline('MCP Servers'));
  console.log();
  if (report.mcpServers.length === 0) {
    console.log(`  ${chalk.dim('No MCP servers configured in ~/.claude.json')}`);
  } else {
    for (const s of report.mcpServers) {
      console.log(`  ${chalk.bold(s.name)} ${chalk.dim(`(${s.type})`)} — ${s.command}${s.args?.length ? ' ' + s.args.join(' ') : ''}`);
    }
  }
  console.log();
}

function profile(sinceMs: number, options: McpOptions): void {
  let servers = profileMcpServers({ sinceMs });
  if (options.json) {
    console.log(JSON.stringify({ servers, tools: profileMcpTools({ sinceMs }) }, null, 2));
    return;
  }
  console.log();
  console.log(chalk.bold.underline('MCP Profile'));
  console.log();
  if (servers.length === 0) {
    console.log(`  ${chalk.dim('No MCP tool calls recorded in this period.')}`);
    console.log();
    return;
  }
  for (const s of servers) {
    const dur = s.avg_duration_ms != null ? `${Math.round(s.avg_duration_ms)}ms avg` : 'no timing';
    const err = s.error_rate > 0 ? chalk.yellow(`${(s.error_rate * 100).toFixed(0)}% errors`) : chalk.green('0% errors');
    console.log(`  ${chalk.bold(s.server)}: ${s.calls} calls, ${s.tools} tools, ${dur}, ${err}, ${fmtBytes(s.total_bytes)}`);
  }
  console.log();
}

function inspect(server: string | undefined, sinceMs: number, options: McpOptions): void {
  if (!server) {
    console.error('Usage: context-pilot mcp inspect <server>');
    process.exit(1);
  }
  const tools = profileMcpTools({ sinceMs }).filter(t => t.server === server);
  if (options.json) {
    console.log(JSON.stringify(tools, null, 2));
    return;
  }
  console.log();
  console.log(chalk.bold.underline(`MCP Server: ${server}`));
  console.log();
  if (tools.length === 0) {
    console.log(`  ${chalk.dim('No recorded calls for this server in the period.')}`);
    console.log();
    return;
  }
  const sorted = [...tools].sort((a, b) => b.calls - a.calls);
  for (const t of sorted) printTool(t);
  console.log();
}

function printTool(t: McpToolProfile): void {
  const dur = t.avg_duration_ms != null ? `${Math.round(t.avg_duration_ms)}ms avg` : 'no timing';
  const err = t.error_rate > 0 ? chalk.yellow(`${(t.error_rate * 100).toFixed(0)}% err`) : chalk.green('ok');
  console.log(`  ${chalk.bold(t.tool)}: ${t.calls} calls, ${dur}, ${fmtBytes(t.avg_bytes)}/call, ${err}`);
}

async function conflicts(options: McpOptions): Promise<void> {
  const report = await detectConflicts();
  const mcpConflicts = report.conflicts.filter(c => c.category === 'mcp');
  if (options.json) {
    console.log(JSON.stringify(mcpConflicts, null, 2));
    return;
  }
  console.log();
  console.log(chalk.bold.underline('MCP Conflicts'));
  console.log();
  if (mcpConflicts.length === 0) {
    console.log(`  ${chalk.green('✓')} No MCP conflicts detected.`);
  } else {
    for (const c of mcpConflicts) {
      console.log(`  ${chalk.yellow(`[${c.severity}]`)} ${c.title}`);
      console.log(`    ${chalk.dim(c.description)}`);
    }
  }
  console.log();
}

function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}KB`;
  return `${n}B`;
}
