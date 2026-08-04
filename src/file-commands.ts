import chalk from 'chalk';

import type { CliEnvironment, CommandOptions } from './cli.js';
import {
  address,
  displayValue,
  formatOptional,
  settingLabel,
  readFileOrUndefined,
  reportInvalidFile,
  reportMissingFile,
  reportUnknownAddress,
} from './cli.js';
import type { CommandRunner } from './defaults.js';
import { readSetting } from './defaults.js';
import { diagnose, repairToml } from './doctor.js';
import type { Diagnosis } from './doctor.js';
import {
  parseValueLiteral,
  readFileValues,
  resolveAddress,
  setValueInFile,
  unsetValueInFile,
} from './edit.js';
import type { SettingDefinition, SettingValue } from './settings/definition.js';
import { registry } from './settings/registry.js';

function logIssues(diagnosis: Diagnosis, file: string, environment: CliEnvironment): void {
  if (diagnosis.errors.length > 0) {
    environment.log(chalk.bold(`${diagnosis.errors.length} problem(s) in ${file}:`));
    for (const issue of diagnosis.errors) {
      const tag = issue.fixable ? chalk.yellow('[fixable]') : chalk.red('[manual]');
      environment.log(`  ${tag} ${issue.message}`);
    }
  }
  for (const issue of diagnosis.warnings) {
    environment.log(`  ${chalk.yellow('[warning]')} ${issue.message}`);
  }
}

async function fixIssues(
  text: string,
  diagnosis: Diagnosis,
  options: CommandOptions,
  environment: CliEnvironment,
): Promise<number> {
  if (!diagnosis.fixable) {
    environment.log(
      chalk.red('Cannot auto-fix: correct the [manual] issue(s) above first, then rerun.'),
    );
    return 1;
  }

  if (diagnosis.errors.length === 0) {
    environment.log(chalk.dim('Nothing auto-fixable; the warning(s) above are advisory only.'));
    return 0;
  }

  await environment.writeTextFile(options.file, repairToml(text, diagnosis));
  const count = diagnosis.errors.length;
  environment.log(
    chalk.green(
      `Removed ${count} unknown entr${count === 1 ? 'y' : 'ies'} and rewrote ${options.file} canonically.`,
    ),
  );

  return 0;
}

/** Check the TOML file for problems; `--fix` removes unknown entries. */
export async function doctorCommand(
  options: CommandOptions,
  environment: CliEnvironment,
): Promise<number> {
  const text = await readFileOrUndefined(options.file, environment);
  if (text === undefined) return reportMissingFile(options.file, environment);

  const diagnosis = diagnose(text);
  if (diagnosis.healthy) {
    const unset = registry.length - diagnosis.setCount;
    environment.log(
      chalk.green(
        `${options.file} is healthy: ${diagnosis.setCount} setting(s) set, ${unset} using macOS defaults.`,
      ),
    );
    return 0;
  }

  logIssues(diagnosis, options.file, environment);

  if (options.fix) return fixIssues(text, diagnosis, options, environment);

  if (diagnosis.errors.length === 0) {
    environment.log(chalk.dim(`${options.file} is valid; the warning(s) above are advisory only.`));
    return 0;
  }
  if (diagnosis.fixable) {
    environment.log(chalk.dim('Run `battlestation doctor --fix` to remove the unknown entries.'));
  }

  return 1;
}

type SettingReport = {
  address: string;
  label: string;
  type: SettingDefinition['type'];
  description: string;
  file: SettingValue | null;
  system: SettingValue | null;
  choices: SettingDefinition['choices'];
  range: SettingDefinition['range'];
  risk: SettingDefinition['risk'];
  keywords: SettingDefinition['keywords'];
  macosDefault: SettingValue | undefined;
  restart: SettingDefinition['restart'];
  requiresLogout: boolean | undefined;
};

async function buildReport(
  definition: SettingDefinition,
  fileValues: Map<SettingDefinition, SettingValue>,
  run: CommandRunner,
): Promise<SettingReport> {
  return {
    address: address(definition),
    label: settingLabel(definition),
    type: definition.type,
    description: definition.description,
    file: fileValues.get(definition) ?? null,
    system: (await readSetting(definition, run)) ?? null,
    choices: definition.choices,
    range: definition.range,
    risk: definition.risk,
    keywords: definition.keywords,
    macosDefault: definition.macosDefault,
    restart: definition.restart,
    requiresLogout: definition.requiresLogout,
  };
}

async function loadFileValues(
  options: CommandOptions,
  environment: CliEnvironment,
): Promise<Map<SettingDefinition, SettingValue> | number> {
  const text = await readFileOrUndefined(options.file, environment);
  if (text === undefined) return new Map();

  try {
    return readFileValues(text);
  } catch (error) {
    return reportInvalidFile(options.file, error, environment);
  }
}

/** List every known setting with its file and system values. */
export async function listCommand(
  options: CommandOptions,
  environment: CliEnvironment,
): Promise<number> {
  const fileValues = await loadFileValues(options, environment);
  if (typeof fileValues === 'number') return fileValues;

  const reports: [SettingDefinition, SettingReport][] = [];
  for (const definition of registry) {
    reports.push([definition, await buildReport(definition, fileValues, environment.run)]);
  }

  if (options.json) {
    environment.log(
      JSON.stringify(
        reports.map(([, report]) => report),
        null,
        2,
      ),
    );
    return 0;
  }

  for (const [definition, report] of reports) {
    const file = formatOptional(report.file ?? undefined, definition);
    const system = formatOptional(report.system ?? undefined, definition);
    environment.log(`${chalk.cyan(report.address.padEnd(44))} file=${file}  system=${system}`);
  }

  return 0;
}

/** Show one setting's file and system values. */
export async function getCommand(
  options: CommandOptions,
  environment: CliEnvironment,
): Promise<number> {
  const [target] = options.arguments;
  if (target === undefined) {
    environment.log(chalk.red('Usage: battlestation get <section.key>'));
    return 1;
  }

  const definition = resolveAddress(target);
  if (definition === undefined) return reportUnknownAddress(target, environment);

  const fileValues = await loadFileValues(options, environment);
  if (typeof fileValues === 'number') return fileValues;

  const report = await buildReport(definition, fileValues, environment.run);

  if (options.json) {
    environment.log(JSON.stringify(report, null, 2));
    return 0;
  }

  environment.log(
    `${chalk.cyan(report.address)} ${chalk.dim(`(${definition.type})`)} — ${definition.description}`,
  );
  environment.log(`  file:   ${formatOptional(report.file ?? undefined, definition)}`);
  environment.log(`  system: ${formatOptional(report.system ?? undefined, definition)}`);

  return 0;
}

/** Set one value in the TOML file. */
export async function setCommand(
  options: CommandOptions,
  environment: CliEnvironment,
): Promise<number> {
  const [target, literal] = options.arguments;
  if (target === undefined || literal === undefined) {
    environment.log(chalk.red('Usage: battlestation set <section.key> <value>'));
    return 1;
  }

  const definition = resolveAddress(target);
  if (definition === undefined) return reportUnknownAddress(target, environment);

  let value: SettingValue;
  try {
    value = parseValueLiteral(definition, literal);
  } catch (error) {
    environment.log(chalk.red(error instanceof Error ? error.message : String(error)));
    return 1;
  }

  const text = await readFileOrUndefined(options.file, environment);
  if (text === undefined) return reportMissingFile(options.file, environment);

  try {
    await environment.writeTextFile(options.file, setValueInFile(text, definition, value));
  } catch (error) {
    return reportInvalidFile(options.file, error, environment);
  }

  environment.log(
    chalk.green(
      `Set ${address(definition)} = ${displayValue(value, definition)} in ${options.file}.`,
    ),
  );
  environment.log(chalk.dim('Run `battlestation apply` to write it to the system.'));

  return 0;
}

/** Remove one value from the TOML file. */
export async function unsetCommand(
  options: CommandOptions,
  environment: CliEnvironment,
): Promise<number> {
  const [target] = options.arguments;
  if (target === undefined) {
    environment.log(chalk.red('Usage: battlestation unset <section.key>'));
    return 1;
  }

  const definition = resolveAddress(target);
  if (definition === undefined) return reportUnknownAddress(target, environment);

  const text = await readFileOrUndefined(options.file, environment);
  if (text === undefined) return reportMissingFile(options.file, environment);

  try {
    await environment.writeTextFile(options.file, unsetValueInFile(text, definition));
  } catch (error) {
    return reportInvalidFile(options.file, error, environment);
  }

  environment.log(chalk.green(`Unset ${address(definition)} in ${options.file}.`));
  environment.log(
    chalk.dim('Applying now deletes it from the system, restoring the macOS default.'),
  );

  return 0;
}
