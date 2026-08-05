import chalk from 'chalk';

import { applyChanges, diffSettings } from './apply.js';
import type { ApplyResult, PendingChange } from './apply.js';
import { captureToml } from './capture.js';
import type { CliEnvironment, CommandOptions } from './cli.js';
import { address, displayValue, settingLabel } from './cli.js';
import { parseToml } from './toml.js';

export type { CliEnvironment, CommandOptions } from './cli.js';
export { commandHelp, help } from './help.js';

function describeChange(change: PendingChange): string {
  const { definition, current, target } = change;
  const from = chalk.red(current === undefined ? '(not set)' : displayValue(current, definition));
  const to = chalk.green(
    target === undefined ? '(macOS default)' : displayValue(target, definition),
  );

  return `  ${chalk.cyan(address(definition))}: ${from} ${chalk.dim('→')} ${to}`;
}

async function loadChanges(path: string, environment: CliEnvironment): Promise<PendingChange[]> {
  const desired = parseToml(await environment.readTextFile(path));

  return diffSettings(desired, environment.run);
}

function changeAsJson(change: PendingChange): Record<string, unknown> {
  return {
    address: address(change.definition),
    label: settingLabel(change.definition),
    current: change.current ?? null,
    target: change.target ?? null,
    restart: change.definition.restart ?? null,
    requiresLogout: change.definition.requiresLogout ?? false,
  };
}

/** The undo-snapshot path that sits alongside a TOML file. */
export function undoPath(file: string): string {
  return file.endsWith('.toml') ? `${file.slice(0, -5)}.undo.toml` : `${file}.undo.toml`;
}

export async function captureCommand(
  options: CommandOptions,
  environment: CliEnvironment,
): Promise<number> {
  const toml = await captureToml(environment.run, environment.now());
  await environment.writeTextFile(options.file, toml);
  environment.log(chalk.green(`Captured system settings to ${chalk.bold(options.file)}.`));

  return 0;
}

export async function diffCommand(
  options: CommandOptions,
  environment: CliEnvironment,
): Promise<number> {
  const changes = await loadChanges(options.file, environment);

  // With --exit-code, drift is reported the way `git diff --exit-code` does,
  // so a scheduled check can act on it.
  const driftCode = options.exitCode && changes.length > 0 ? 1 : 0;

  if (options.json) {
    environment.log(JSON.stringify(changes.map(changeAsJson), null, 2));
    return driftCode;
  }

  if (changes.length === 0) {
    environment.log(chalk.green('System matches the TOML file. Nothing to change.'));
    return 0;
  }

  environment.log(chalk.bold(`${changes.length} setting(s) would change:`));
  for (const change of changes) environment.log(describeChange(change));

  return driftCode;
}

function logJson(environment: CliEnvironment, payload: unknown): number {
  environment.log(JSON.stringify(payload, null, 2));

  return 0;
}

function reportApplyOutcome(
  changes: PendingChange[],
  result: ApplyResult,
  undoFile: string,
  options: CommandOptions,
  environment: CliEnvironment,
): number {
  if (options.json) {
    return logJson(environment, {
      applied: true,
      changes: changes.map(changeAsJson),
      restarted: result.restarted,
      requiresLogout: result.requiresLogout,
      undoFile,
    });
  }

  environment.log(chalk.green(`Applied ${changes.length} change(s).`));
  environment.log(
    chalk.dim(
      `Undo snapshot saved to ${undoFile}; revert with \`battlestation apply --file ${undoFile}\`.`,
    ),
  );
  if (result.restarted.length > 0) {
    environment.log(`Restarted: ${result.restarted.join(', ')}.`);
  }
  if (result.requiresLogout) {
    environment.log(chalk.yellow('Some changes take full effect after you log out and back in.'));
  }

  return 0;
}

function reportNothingToApply(options: CommandOptions, environment: CliEnvironment): number {
  if (options.json) return logJson(environment, { applied: false, changes: [] });

  environment.log(chalk.green('System already matches the TOML file. Nothing applied.'));
  return 0;
}

function reportDryRun(
  changes: PendingChange[],
  options: CommandOptions,
  environment: CliEnvironment,
): number {
  if (options.json) {
    return logJson(environment, { applied: false, changes: changes.map(changeAsJson) });
  }

  environment.log(chalk.yellow('Dry run; nothing applied.'));
  return 0;
}

export async function applyCommand(
  options: CommandOptions,
  environment: CliEnvironment,
): Promise<number> {
  if (options.json && !options.yes && !options.dryRun) {
    environment.log(chalk.red('apply --json is non-interactive; pass --yes (or --dry-run).'));
    return 1;
  }

  const changes = await loadChanges(options.file, environment);
  if (changes.length === 0) return reportNothingToApply(options, environment);

  if (!options.json) {
    environment.log(chalk.bold(`${changes.length} setting(s) to apply:`));
    for (const change of changes) environment.log(describeChange(change));
  }

  if (options.dryRun) return reportDryRun(changes, options, environment);

  const question = chalk.bold(`Apply ${changes.length} change(s)? [y/N] `);
  if (!options.yes && !(await environment.confirm(question))) {
    environment.log(chalk.yellow('Aborted; nothing applied.'));
    return 1;
  }

  const undoFile = undoPath(options.file);
  await environment.writeTextFile(undoFile, await captureToml(environment.run, environment.now()));

  const result = await applyChanges(changes, environment.run);

  return reportApplyOutcome(changes, result, undoFile, options, environment);
}
