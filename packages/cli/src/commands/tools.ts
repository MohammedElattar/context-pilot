import chalk from 'chalk';
import { detectAllTools } from '@contextpilot/core';

interface ToolsOptions {
  json?: boolean;
}

export async function runTools(options: ToolsOptions): Promise<void> {
  const tools = await detectAllTools();

  if (options.json) {
    console.log(JSON.stringify(tools, null, 2));
    return;
  }

  console.log();
  console.log(chalk.bold.underline('Optimization Tools'));
  console.log();

  const statusColors: Record<string, (s: string) => string> = {
    'installed': chalk.green,
    'detected': chalk.yellow,
    'not-found': chalk.dim,
    'error': chalk.red,
  };

  for (const tool of tools) {
    const color = statusColors[tool.status] ?? chalk.white;
    const ver = tool.version ? ` v${tool.version}` : '';
    const health = tool.healthy ? chalk.green('healthy') : chalk.dim(tool.healthMessage);

    console.log(`  ${color('●')} ${chalk.bold(tool.name)}${ver} — ${tool.status}`);

    if (tool.status !== 'not-found') {
      console.log(`    Health: ${health}`);
      console.log(`    Capabilities: ${tool.capabilities.join(', ')}`);
    }

    if (tool.conflicts.length > 0 && tool.status !== 'not-found') {
      for (const conflict of tool.conflicts) {
        const installed = tools.find(t => t.id === conflict.withTool && t.status !== 'not-found');
        if (installed) {
          console.log(`    ${chalk.yellow('⚠')} Conflict with ${conflict.withTool}: ${conflict.reason}`);
        }
      }
    }

    console.log();
  }
}
