#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import chalk from 'chalk';

import { applyCommand, captureCommand, commandHelp, diffCommand, help } from './commands.js';
import type { CliEnvironment, CommandOptions } from './commands.js';
import { resolveConfiguration } from './configuration.js';
import { runCommand } from './defaults.js';
import {
  doctorCommand,
  getCommand,
  listCommand,
  setCommand,
  unsetCommand,
} from './file-commands.js';
import { mcpCommand } from './mcp.js';
import { scheduleCommand } from './schedule.js';

export { applyChanges, diffSettings } from './apply.js';
export type { ApplyResult, PendingChange } from './apply.js';
export { settingLabel } from './cli.js';
export type { CliEnvironment } from './commands.js';
export { captureSettings, captureToml } from './capture.js';
export { deleteSetting, readSetting, runCommand, writeSetting } from './defaults.js';
export type { CommandResult, CommandRunner } from './defaults.js';
export { diagnose, repairToml } from './doctor.js';
export type { Diagnosis } from './doctor.js';
export type {
  PlistValue,
  RestartTarget,
  SettingChoice,
  SettingDefinition,
  SettingRange,
  SettingType,
  SettingValue,
} from './settings/definition.js';
export { findDefinition, registry } from './settings/registry.js';
export { analyzeToml, parseToml, renderToml, settingLegend } from './toml.js';
export {
  configurationSchema,
  createConfigurationSchema,
  defaultManifestPath,
  expandPath,
  resolveConfiguration,
} from './configuration.js';
export type { ResolvedConfiguration } from './configuration.js';
export type { CapturedSetting, DesiredSetting, TomlAnalysis, TomlIssue } from './toml.js';

/** Every CLI command, keyed by name. */
export const commands: Record<
  string,
  (options: CommandOptions, environment: CliEnvironment) => Promise<number>
> = {
  capture: captureCommand,
  diff: diffCommand,
  apply: applyCommand,
  doctor: doctorCommand,
  list: listCommand,
  get: getCommand,
  set: setCommand,
  unset: unsetCommand,
  mcp: mcpCommand,
  schedule: scheduleCommand,
};

/** Run the CLI with the given arguments. Returns the process exit code. */
export async function run(argv: string[], environment: CliEnvironment): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      // No defaults here: an absent flag must fall through to the
      // configuration resolved from the environment, not shadow it.
      file: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      fix: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'exit-code': { type: 'boolean', default: false },
      interval: { type: 'string' },
      uninstall: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const commandName = positionals[0];

  if (values.help || commandName === undefined) {
    environment.log(commandName === undefined ? help : (commandHelp[commandName] ?? help));
    return values.help ? 0 : 1;
  }

  const command = commands[commandName];
  if (command === undefined) {
    environment.log(`${chalk.red(`Unknown command: ${commandName}`)}\n\n${help}`);
    return 1;
  }

  return command(
    {
      file: values.file ?? environment.configuration.file,
      dryRun: values['dry-run'],
      yes: values.yes,
      fix: values.fix,
      json: values.json,
      exitCode: values['exit-code'],
      interval: values.interval ?? environment.configuration.interval,
      uninstall: values.uninstall,
      arguments: positionals.slice(1),
    },
    environment,
  );
}

/**
 * Ask a yes/no question on the terminal. Anything other than an explicit
 * yes — including a closed stdin — answers no.
 */
export async function askConfirmation(
  question: string,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<boolean> {
  const readline = createInterface({ input, output });

  try {
    const answer = await readline.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

/** The real environment used when the CLI runs as a process. */
export async function defaultEnvironment(): Promise<CliEnvironment> {
  return {
    configuration: await resolveConfiguration(),
    run: runCommand,
    readTextFile: (path) => readFile(path, 'utf8'),
    writeTextFile: async (path, contents) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, 'utf8');
    },
    removeTextFile: (path) => rm(path, { force: true }),
    log: (message) => process.stdout.write(`${message}\n`),
    confirm: askConfirmation,
    now: () => new Date(),
  };
}

/**
 * True when the module at `moduleUrl` is the process entry point. Symlinked
 * launchers (like the bin shim) are resolved to their real path; virtual
 * paths inside Bun's compiled executables cannot be resolved and are
 * compared as-is.
 */
export function isMainModule(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;

  let resolved = argv1;
  try {
    resolved = realpathSync(argv1);
  } catch {
    // Keep the virtual path.
  }

  return moduleUrl === pathToFileURL(resolved).href;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2), await defaultEnvironment());
}
