import { capitalCase } from 'change-case';
import chalk from 'chalk';

import type { CommandRunner } from './defaults.js';
import type { SettingDefinition, SettingValue } from './settings/definition.js';
import { formatTomlValue } from './toml.js';

/** The pieces of the outside world the CLI touches, injectable for tests. */
export type CliEnvironment = {
  run: CommandRunner;
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, contents: string) => Promise<void>;
  removeTextFile: (path: string) => Promise<void>;
  log: (message: string) => void;
  confirm: (question: string) => Promise<boolean>;
  now: () => Date;
};

/** The options every command receives after argument parsing. */
export type CommandOptions = {
  file: string;
  dryRun: boolean;
  yes: boolean;
  fix: boolean;
  json: boolean;
  /** For diff: exit nonzero when the system has drifted. */
  exitCode: boolean;
  /** For schedule: how often the drift check runs. */
  interval: string;
  /** For schedule: remove the agent instead of installing it. */
  uninstall: boolean;
  /** Positional arguments after the command name (e.g. address and value). */
  arguments: string[];
};

/** The `section.key` address of a setting. */
export function address(definition: SettingDefinition): string {
  return `${definition.section}.${definition.key}`;
}

/** The display name of a setting: its override, or one derived from the key. */
export function settingLabel(definition: SettingDefinition): string {
  return definition.label ?? capitalCase(definition.key);
}

/**
 * Format a value for one-line display. Structured values are summarized
 * rather than dumped — the TOML file is the place to read them in full.
 */
export function displayValue(value: SettingValue, definition: SettingDefinition): string {
  if (definition.type !== 'plist') return formatTomlValue(value, definition.type);

  const size = Array.isArray(value)
    ? `${value.length} item(s)`
    : typeof value === 'object'
      ? `${Object.keys(value).length} entr${Object.keys(value).length === 1 ? 'y' : 'ies'}`
      : JSON.stringify(value);

  return `(structured: ${size})`;
}

/** Format a possibly-unset value for display. */
export function formatOptional(
  value: SettingValue | undefined,
  definition: SettingDefinition,
): string {
  return value === undefined ? chalk.dim('(not set)') : displayValue(value, definition);
}

/** Read a file, treating any failure (usually a missing file) as undefined. */
export async function readFileOrUndefined(
  path: string,
  environment: CliEnvironment,
): Promise<string | undefined> {
  try {
    return await environment.readTextFile(path);
  } catch {
    return undefined;
  }
}

/** Report an unreadable TOML file and point at doctor. Returns exit code 1. */
export function reportInvalidFile(
  file: string,
  error: unknown,
  environment: CliEnvironment,
): number {
  const message = error instanceof Error ? error.message : String(error);
  environment.log(chalk.red(`${file} is invalid: ${message}`));
  environment.log(chalk.dim('Run `battlestation doctor` for a full report.'));

  return 1;
}

/** Report a missing TOML file and point at capture. Returns exit code 1. */
export function reportMissingFile(file: string, environment: CliEnvironment): number {
  environment.log(chalk.red(`Cannot read ${file}.`));
  environment.log(chalk.dim('Run `battlestation capture` to create it.'));

  return 1;
}

/** Report an address that matches no registered setting. Returns exit code 1. */
export function reportUnknownAddress(target: string, environment: CliEnvironment): number {
  environment.log(chalk.red(`Unknown setting "${target}".`));
  environment.log(chalk.dim('Run `battlestation list` to see every known setting.'));

  return 1;
}
