import { $ } from 'bun';
import chalk from 'chalk';
import { capitalCase } from 'change-case';

export const isContinuousIntegration = () =>
  process.env['CI'] === 'true' || process.env['CI'] === '1';

export function header(title: string) {
  const text = capitalCase(title);
  console.log('\n' + chalk.bgBlue.black(` ${text} `));
}

export const info = (msg: string) => console.log(chalk.cyan(msg));
export const success = (msg: string) => console.log(chalk.green(msg));
export const warning = (msg: string) => console.log(chalk.yellow(msg));
export const error = (msg: string) => console.error(chalk.red(msg));

export async function getStagedFiles(): Promise<string[]> {
  const out = await $`git diff --cached --name-only`.text();
  return out.split('\n').filter(Boolean);
}

export async function fileChangedBetween(
  file: string,
  prev: string,
  next: string,
): Promise<boolean> {
  const out = await $`git diff --name-only ${prev}..${next} -- ${file}`.text();
  return out.trim().length > 0;
}

/** Install dependencies, reporting success or a non-fatal warning. */
export async function installDependencies(): Promise<void> {
  info('Dependencies changed, installing…');
  try {
    await $`bun install`.quiet();
    success('Dependencies installed');
  } catch {
    warning('Failed to install dependencies — run bun install manually');
  }
}
