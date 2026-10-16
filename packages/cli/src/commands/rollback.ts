import chalk from 'chalk';
import { loadConfig, setMode } from '@contextpilot/core';

export async function runRollback(options: { json?: boolean }): Promise<void> {
  const config = loadConfig();

  if (config.mode === 'observe') {
    if (options.json) {
      console.log(JSON.stringify({ status: 'already-observe', mode: config.mode }));
      return;
    }
    console.log(`${chalk.dim('Already in observe mode. Nothing to roll back.')}`);
    return;
  }

  const previous = config.mode;
  setMode('observe');

  if (options.json) {
    console.log(JSON.stringify({ status: 'rolled-back', from: previous, to: 'observe' }));
    return;
  }

  console.log(`Rolled back from ${chalk.yellow(previous)} to ${chalk.green('observe')} mode.`);
  console.log(chalk.dim('All active optimizations disabled. Claude Code behavior restored to default.'));
}
