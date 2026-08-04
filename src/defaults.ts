import { execFile } from 'node:child_process';

import { readDockApplications, writeDockApplications } from './dock-apps.js';
import { parseJsonPlist, plistPath, toPlistXml } from './plist.js';
import type { SettingDefinition, SettingValue } from './settings/definition.js';

/** The result of running an external command. */
export type CommandResult = {
  stdout: string;
  exitCode: number;
};

/**
 * Runs an external command and reports its stdout and exit code.
 *
 * Injected everywhere a command is needed so tests can substitute a fake and
 * the real implementation stays a single, small seam.
 */
export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

/** The default runner: `execFile` (no shell), tolerating nonzero exits. */
export const runCommand: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      resolve({ stdout, exitCode: error ? 1 : 0 });
    });
  });

function hostFlags(definition: SettingDefinition): string[] {
  return definition.perHost ? ['-currentHost'] : [];
}

/**
 * Parse raw `defaults read` output into a typed value.
 *
 * `defaults` prints booleans as 0/1 (or true/false), numbers bare, and
 * strings verbatim.
 */
export function parseDefaultsOutput(raw: string, type: SettingDefinition['type']): SettingValue {
  const text = raw.trim();

  if (type === 'boolean') return text === '1' || text.toLowerCase() === 'true';
  if (type === 'integer') return Number.parseInt(text, 10);
  if (type === 'float') return Number.parseFloat(text);

  return text;
}

/**
 * Read one setting from the system. Returns undefined when the key is not
 * set (macOS falls back to its built-in default).
 *
 * Scalar values come from `defaults read`; structured (`plist`) values are
 * extracted from the domain's plist file as JSON via `plutil`, since the
 * OpenStep text `defaults read` prints is not reliably parseable.
 */
export async function readSetting(
  definition: SettingDefinition,
  run: CommandRunner,
): Promise<SettingValue | undefined> {
  if (definition.special === 'dock-applications') return readDockApplications(run);

  if (definition.type === 'plist') {
    const result = await run('plutil', [
      '-extract',
      definition.defaultsKey,
      'json',
      '-o',
      '-',
      plistPath(definition.domain),
    ]);
    if (result.exitCode !== 0) return undefined;

    return parseJsonPlist(result.stdout);
  }

  const result = await run('defaults', [
    ...hostFlags(definition),
    'read',
    definition.domain,
    definition.defaultsKey,
  ]);
  if (result.exitCode !== 0) return undefined;

  return parseDefaultsOutput(result.stdout, definition.type);
}

/** The `defaults write` type flag and argument for a value. */
export function writeArguments(definition: SettingDefinition, value: SettingValue): string[] {
  if (definition.type === 'plist') return [toPlistXml(value)];
  if (typeof value === 'object') {
    throw new TypeError(`${definition.defaultsKey} is scalar but received a structured value`);
  }
  if (definition.type === 'boolean') return ['-bool', value ? 'true' : 'false'];
  if (definition.type === 'integer') return ['-int', String(value)];
  if (definition.type === 'float') return ['-float', String(value)];

  return ['-string', String(value)];
}

/**
 * Write one setting to the system, including any mirror domains (for
 * example the Bluetooth trackpad domain mirroring the built-in one).
 */
export async function writeSetting(
  definition: SettingDefinition,
  value: SettingValue,
  run: CommandRunner,
): Promise<void> {
  if (definition.special === 'dock-applications') return writeDockApplications(value, run);

  const domains = [definition.domain, ...(definition.mirrorDomains ?? [])];

  for (const domain of domains) {
    const result = await run('defaults', [
      ...hostFlags(definition),
      'write',
      domain,
      definition.defaultsKey,
      ...writeArguments(definition, value),
    ]);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to write ${domain} ${definition.defaultsKey}`);
    }
  }
}

/**
 * Remove one setting from the system so macOS falls back to its built-in
 * default. Deleting an already-absent key (for example in a mirror domain)
 * is treated as success.
 */
export async function deleteSetting(
  definition: SettingDefinition,
  run: CommandRunner,
): Promise<void> {
  const domains = [definition.domain, ...(definition.mirrorDomains ?? [])];

  for (const domain of domains) {
    await run('defaults', [...hostFlags(definition), 'delete', domain, definition.defaultsKey]);
  }
}
