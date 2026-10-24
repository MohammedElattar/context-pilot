import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import chalk from 'chalk';
import { paths } from '@contextpilot/core';

const ROUTING_MARKER = '<!-- contextpilot:research-routing -->';
const ROUTING_BLOCK = `${ROUTING_MARKER}
## Research routing (ContextPilot)

For external research (web pages, docs, GitHub issues/PRs, PDFs), prefer the ContextPilot MCP tools over native \`WebFetch\`/\`WebSearch\`:

- Discover with \`contextpilot_search\`, then read URLs with \`contextpilot_research\` (several URLs or a GitHub issue/PR in one call) or \`contextpilot_fetch\` (a single URL). Pass the error text or question as \`focus\`/\`query\`.
- Recover an omitted detail with \`contextpilot_expand({ evidence_id })\` — do not re-fetch the same URL or loop fetch→expand.
- They return ranked, token-budgeted, cached evidence with exact errors preserved. If a gateway call returns \`ok:false\`, fall back to the native tool.
<!-- /contextpilot:research-routing -->`;

function findProjectRoot(): string {
  // Try from import.meta.url first, then cwd
  const candidates = [
    dirname(new URL(import.meta.url).pathname),
    process.cwd(),
  ];
  for (const start of candidates) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

export async function runSetup(opts: { json?: boolean; research?: boolean; strict?: boolean }) {
  // Strict routing implies the research setup (advisor + skill + router).
  if (opts.strict) opts = { ...opts, research: true };
  const results: { mcp: boolean; hooks: boolean; messages: string[] } = {
    mcp: false, hooks: false, messages: [],
  };

  // 1. Register MCP server in ~/.claude.json
  // Find project root by walking up from import.meta.url or cwd until we find pnpm-workspace.yaml
  const projectRoot = findProjectRoot();
  const mcpBinPath = resolve(projectRoot, 'packages', 'mcp', 'dist', 'index.js');

  try {
    const claudeJsonPath = paths.claude.json;
    let config: any = {};
    if (existsSync(claudeJsonPath)) {
      config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'));
    }

    if (!config.mcpServers) config.mcpServers = {};

    config.mcpServers.contextpilot = {
      type: 'stdio',
      command: 'node',
      args: [mcpBinPath],
      env: {},
    };

    writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2) + '\n');
    results.mcp = true;
    results.messages.push(`MCP server registered: ${mcpBinPath}`);
  } catch (err) {
    results.messages.push(`MCP registration failed: ${err instanceof Error ? err.message : err}`);
  }

  // 2. Register hooks in ~/.claude/settings.local.json
  try {
    const localSettingsPath = resolve(paths.claude.dir, 'settings.local.json');
    let settings: any = {};
    if (existsSync(localSettingsPath)) {
      settings = JSON.parse(readFileSync(localSettingsPath, 'utf-8'));
    }

    if (!settings.hooks) settings.hooks = {};

    const hookBase = resolve(projectRoot, 'packages', 'cli', 'dist', 'hooks');
    const observerCmd = `node ${resolve(hookBase, 'observer.js')}`;
    const promptCmd = `node ${resolve(hookBase, 'prompt-advisor.js')}`;
    const compactCmd = `node ${resolve(hookBase, 'compact-advisor.js')}`;

    const hookEntry = (cmd: string, timeout: number) => [{ hooks: [{ type: 'command', command: cmd, timeout }] }];

    const observerEvents = ['SessionStart', 'PostToolUse', 'PostToolUseFailure', 'PreCompact', 'Stop', 'SessionEnd'];
    for (const event of observerEvents) {
      const existing = settings.hooks[event] ?? [];
      const alreadyRegistered = existing.some((g: any) =>
        g.hooks?.some((h: any) => h.command?.includes('context-pilot') || h.command?.includes('contextpilot'))
      );
      if (!alreadyRegistered) {
        settings.hooks[event] = [...existing, ...hookEntry(observerCmd, 5)];
      }
    }

    // Status line — model, effort, 5h/weekly limits. Only set when the user has
    // no status line of their own, so an existing one is never overwritten.
    const statuslineCmd = `node ${resolve(projectRoot, 'packages', 'cli', 'dist', 'statusline', 'statusline.js')}`;
    if (!settings.statusLine) {
      settings.statusLine = { type: 'command', command: statuslineCmd };
      results.messages.push('Status line registered (model, effort, 5h/weekly limits).');
    } else if (String(settings.statusLine.command ?? '').includes('statusline')) {
      settings.statusLine = { type: 'command', command: statuslineCmd };
    } else {
      results.messages.push('Existing status line kept; ContextPilot status line not installed.');
    }

    // UserPromptExpansion — prompt advisor (safe: Caveman not hooked)
    const upeExisting = settings.hooks['UserPromptExpansion'] ?? [];
    const upeRegistered = upeExisting.some((g: any) =>
      g.hooks?.some((h: any) => h.command?.includes('prompt-advisor'))
    );
    if (!upeRegistered) {
      settings.hooks['UserPromptExpansion'] = [...upeExisting, ...hookEntry(promptCmd, 3)];
    }

    // PostCompact — compact advisor (safe: Caveman hooks PreCompact, not PostCompact)
    const pcExisting = settings.hooks['PostCompact'] ?? [];
    const pcRegistered = pcExisting.some((g: any) =>
      g.hooks?.some((h: any) => h.command?.includes('compact-advisor'))
    );
    if (!pcRegistered) {
      settings.hooks['PostCompact'] = [...pcExisting, ...hookEntry(compactCmd, 3)];
    }

    // PreToolUse — re-read guard. NON-BLOCKING: only adds additionalContext.
    {
      const rereadCmd = `node ${resolve(hookBase, 'reread-guard.js')}`;
      const ptuExisting = settings.hooks['PreToolUse'] ?? [];
      const rereadRegistered = ptuExisting.some((g: any) =>
        g.hooks?.some((h: any) => h.command?.includes('reread-guard'))
      );
      if (!rereadRegistered) {
        settings.hooks['PreToolUse'] = [...ptuExisting, ...hookEntry(rereadCmd, 3)];
      }
    }

    // PreToolUse — research advisor (opt-in via --research). NON-BLOCKING:
    // it only adds additionalContext, never a permissionDecision, so it coexists
    // with Caveman's PreToolUse hooks and never blocks a tool. Strict routing off.
    if (opts.research) {
      const researchCmd = `node ${resolve(hookBase, 'research-advisor.js')}`;
      const ptuExisting = settings.hooks['PreToolUse'] ?? [];
      const ptuRegistered = ptuExisting.some((g: any) =>
        g.hooks?.some((h: any) => h.command?.includes('research-advisor'))
      );
      if (!ptuRegistered) {
        settings.hooks['PreToolUse'] = [...ptuExisting, ...hookEntry(researchCmd, 3)];
      }

      // Strict routing (opt-in): a PreToolUse hook that DENIES native
      // WebFetch/WebSearch. Escape with CONTEXTPILOT_ALLOW_NATIVE=1.
      if (opts.strict) {
        const routerCmd = `node ${resolve(hookBase, 'research-router.js')}`;
        const current = settings.hooks['PreToolUse'] ?? [];
        const routerRegistered = current.some((g: any) =>
          g.hooks?.some((h: any) => h.command?.includes('research-router'))
        );
        if (!routerRegistered) {
          settings.hooks['PreToolUse'] = [...current, ...hookEntry(routerCmd, 3)];
        }
      }
    }

    mkdirSync(dirname(localSettingsPath), { recursive: true });
    writeFileSync(localSettingsPath, JSON.stringify(settings, null, 2) + '\n');
    results.hooks = true;
    results.messages.push('Observer + advisor hooks registered in ~/.claude/settings.local.json');
    if (opts.research) {
      // Install the research skill into a Claude-Code-discovered location
      // (~/.claude/skills/<name>/SKILL.md); the repo's skills/ dir is not scanned.
      try {
        const skillSrc = resolve(projectRoot, 'skills', 'research', 'SKILL.md');
        const skillDestDir = resolve(paths.claude.dir, 'skills', 'research');
        mkdirSync(skillDestDir, { recursive: true });
        writeFileSync(resolve(skillDestDir, 'SKILL.md'), readFileSync(skillSrc, 'utf-8'));
        results.messages.push('Research advisory registered; skill installed to ~/.claude/skills/research/SKILL.md.');
      } catch (err) {
        results.messages.push(`Research advisory registered; skill install failed: ${err instanceof Error ? err.message : err}`);
      }

      // Proactive routing: add a research-routing block to the user-level
      // ~/.claude/CLAUDE.md so Claude prefers the gateway before trying native
      // tools, in every project. Idempotent via a marker; appends if the file
      // exists, creates it otherwise.
      try {
        const claudeMd = resolve(paths.claude.dir, 'CLAUDE.md');
        const existing = existsSync(claudeMd) ? readFileSync(claudeMd, 'utf-8') : '';
        if (existing.includes(ROUTING_MARKER)) {
          results.messages.push('Research routing already present in ~/.claude/CLAUDE.md.');
        } else {
          mkdirSync(dirname(claudeMd), { recursive: true });
          const prefix = existing && !existing.endsWith('\n') ? '\n\n' : existing ? '\n' : '';
          writeFileSync(claudeMd, existing + prefix + ROUTING_BLOCK + '\n');
          results.messages.push(`Research routing ${existing ? 'appended to' : 'written to'} ~/.claude/CLAUDE.md.`);
        }
      } catch (err) {
        results.messages.push(`Research routing install failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  } catch (err) {
    results.messages.push(`Hook registration failed: ${err instanceof Error ? err.message : err}`);
  }

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(chalk.bold('ContextPilot Setup'));
  console.log();
  console.log(`  MCP Server: ${results.mcp ? chalk.green('✓ registered') : chalk.red('✗ failed')}`);
  console.log(`  Hooks:      ${results.hooks ? chalk.green('✓ registered') : chalk.red('✗ failed')}`);
  console.log();
  for (const msg of results.messages) {
    console.log(`  ${chalk.dim('→')} ${msg}`);
  }
  console.log();
  console.log(chalk.dim('  Restart Claude Code for changes to take effect.'));
}
