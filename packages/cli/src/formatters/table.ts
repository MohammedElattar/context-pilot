import chalk from 'chalk';

export type CheckStatus = 'ok' | 'warn' | 'error' | 'skip' | 'info';

export interface CheckResult {
  status: CheckStatus;
  label: string;
  value: string;
  detail?: string;
}

const statusIcons: Record<CheckStatus, string> = {
  ok: chalk.green('✓'),
  warn: chalk.yellow('⚠'),
  error: chalk.red('✗'),
  skip: chalk.dim('○'),
  info: chalk.blue('ℹ'),
};

export function printSection(title: string, checks: CheckResult[]): void {
  console.log();
  console.log(chalk.bold.underline(title));
  console.log();

  for (const check of checks) {
    const icon = statusIcons[check.status];
    console.log(`  ${icon} ${chalk.dim(check.label + ':')} ${check.value}`);
    if (check.detail) {
      console.log(`    ${chalk.dim(check.detail)}`);
    }
  }
}

export function printConflicts(conflicts: Array<{ event: string; reason: string }>): void {
  if (conflicts.length === 0) return;

  console.log();
  console.log(chalk.bold.underline('Conflicts'));
  console.log();

  for (const conflict of conflicts) {
    console.log(`  ${chalk.yellow('⚠')} ${chalk.yellow(conflict.event)}: ${conflict.reason}`);
  }
}

export function printRecommendations(recs: string[]): void {
  if (recs.length === 0) return;

  console.log();
  console.log(chalk.bold.underline('Recommendations'));
  console.log();

  for (const rec of recs) {
    console.log(`  ${chalk.blue('→')} ${rec}`);
  }
}
