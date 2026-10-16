import chalk from 'chalk';
import { loadConfig, setMode, type OperatingMode } from '@contextpilot/core';

const VALID_MODES = ['observe', 'canary', 'auto'] as const;

const MODE_DESCRIPTIONS: Record<OperatingMode, string> = {
  observe: 'Record telemetry only. No modifications to Claude Code behavior.',
  canary: 'Apply optimizations to a fraction of sessions. Reversible.',
  auto: 'Actively select and apply optimizations based on measured effectiveness.',
};

export async function runMode(modeName?: string, options?: { json?: boolean }): Promise<void> {
  if (!modeName) {
    const config = loadConfig();
    if (options?.json) {
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    console.log();
    console.log(chalk.bold('Current mode:'), chalk.cyan(config.mode));
    console.log(`  ${MODE_DESCRIPTIONS[config.mode]}`);
    if (config.updatedAt) {
      console.log(`  ${chalk.dim(`Set at: ${config.updatedAt}`)}`);
    }
    console.log();
    console.log(chalk.dim('Available modes:'));
    for (const m of VALID_MODES) {
      const marker = m === config.mode ? chalk.cyan('→') : ' ';
      console.log(`  ${marker} ${chalk.bold(m)}: ${MODE_DESCRIPTIONS[m]}`);
    }
    console.log();
    return;
  }

  if (!VALID_MODES.includes(modeName as OperatingMode)) {
    console.error(`Invalid mode: ${modeName}. Valid modes: ${VALID_MODES.join(', ')}`);
    process.exit(1);
  }

  const config = setMode(modeName as OperatingMode);

  if (options?.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  console.log(`Mode set to ${chalk.cyan(config.mode)}: ${MODE_DESCRIPTIONS[config.mode]}`);
}
