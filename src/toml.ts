import { parse } from 'smol-toml';

import { isPlistValue } from './plist.js';

import type { SettingDefinition, SettingValue } from './settings/definition.js';
import { findDefinition, registry, sectionOrder } from './settings/registry.js';

/** A setting paired with its captured value (undefined when not set). */
export type CapturedSetting = {
  definition: SettingDefinition;
  value: SettingValue | undefined;
};

/** A setting paired with a value requested by the TOML file. */
export type DesiredSetting = {
  definition: SettingDefinition;
  value: SettingValue;
};

/**
 * Format a value as a TOML literal matching the setting's declared type.
 * Structured (`plist`) values become pretty-printed JSON inside a TOML
 * multi-line literal string, keeping them readable and diffable.
 */
export function formatTomlValue(value: SettingValue, type: SettingDefinition['type']): string {
  if (type === 'plist') return formatPlistValue(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    return type === 'float' && Number.isInteger(value) ? value.toFixed(1) : String(value);
  }

  return JSON.stringify(value);
}

function formatKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function formatInlineValue(value: SettingValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatInlineValue(entry)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, entry]) => `${formatKey(key)} = ${formatInlineValue(entry)}`,
    );
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);

  return JSON.stringify(value);
}

/**
 * Format a structured value as native TOML: scalars and inline tables stay
 * on one line; long arrays wrap one element per line. Dictionaries at the
 * top level of a setting are rendered as sub-tables by {@link renderToml}
 * instead, since TOML inline tables cannot span lines.
 */
export function formatPlistValue(value: SettingValue): string {
  if (Array.isArray(value)) {
    const inline = formatInlineValue(value);
    if (inline.length <= 76) return inline;

    return `[\n${value.map((entry) => `  ${formatInlineValue(entry)},`).join('\n')}\n]`;
  }

  return formatInlineValue(value);
}

function isDictionary(value: SettingValue | undefined): value is Record<string, SettingValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderSubTables(path: string[], dictionary: Record<string, SettingValue>): string[] {
  const lines = [`[${path.map((segment) => formatKey(segment)).join('.')}]`];
  const nested: [string, Record<string, SettingValue>][] = [];

  for (const [key, entry] of Object.entries(dictionary)) {
    if (isDictionary(entry)) {
      nested.push([key, entry]);
    } else {
      lines.push(`${formatKey(key)} = ${formatPlistValue(entry)}`);
    }
  }

  for (const [key, entry] of nested) {
    lines.push('', ...renderSubTables([...path, key], entry));
  }

  return lines;
}

/**
 * The full comment for a setting: its description plus a legend generated
 * from its structured value domain, so legends can never drift from the
 * data that validates them.
 */
function describeScalar(value: SettingValue): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function settingLegend(definition: SettingDefinition): string {
  const parts = [definition.description];

  if (definition.choices) {
    const values = definition.choices
      .map((choice) => `${String(choice.value)} = ${choice.label}`)
      .join(', ');
    parts.push(`Values: ${values}.`);
  }
  if (definition.range) {
    const unit = definition.range.unit ? ` ${definition.range.unit}` : '';
    parts.push(`Range: ${definition.range.min}–${definition.range.max}${unit}.`);
  }
  if (definition.macosDefault !== undefined) {
    parts.push(`macOS default: ${describeScalar(definition.macosDefault)}.`);
  }

  return parts.join(' ');
}

/**
 * Render captured settings as an annotated TOML document. Every setting gets
 * its legend as a comment; unset settings appear as commented-out keys
 * so the file documents everything it could manage.
 */
export function renderToml(captured: CapturedSetting[], headerLines: string[]): string {
  const lines: string[] = headerLines.map((line) => (line === '' ? '' : `# ${line}`));

  for (const section of sectionOrder) {
    lines.push('', `[${section}]`);
    const inSection = captured.filter((entry) => entry.definition.section === section);

    // Dictionary-valued settings render as sub-tables, which must come after
    // every plain key of the section to stay attached to the right table.
    const dictionaries = inSection.filter(
      (entry) => entry.definition.type === 'plist' && isDictionary(entry.value),
    );

    for (const { definition, value } of inSection) {
      if (dictionaries.some((entry) => entry.definition === definition)) continue;

      lines.push('');
      lines.push(`# ${settingLegend(definition)}`);

      if (value === undefined) {
        lines.push(`# ${definition.key} is not set; macOS uses its built-in default.`);
      } else {
        lines.push(`${definition.key} = ${formatTomlValue(value, definition.type)}`);
      }
    }

    for (const { definition, value } of dictionaries) {
      if (!isDictionary(value)) continue;

      lines.push('');
      lines.push(`# ${settingLegend(definition)}`);
      lines.push(...renderSubTables([section, definition.key], value));
    }
  }

  lines.push('');

  return lines.join('\n');
}

function coerce(definition: SettingDefinition, raw: unknown): SettingValue {
  const address = `${definition.section}.${definition.key}`;

  if (definition.type === 'plist') {
    if (!isPlistValue(raw)) {
      throw new TypeError(`${address} must be a TOML value with no nulls or dates`);
    }
    return raw;
  }

  if (definition.type === 'boolean') {
    if (typeof raw !== 'boolean') throw new TypeError(`${address} must be true or false`);
    return raw;
  }

  if (definition.type === 'integer' || definition.type === 'float') {
    if (typeof raw !== 'number') throw new TypeError(`${address} must be a number`);
    return raw;
  }

  if (typeof raw !== 'string') throw new TypeError(`${address} must be a string`);

  return raw;
}

/**
 * One problem found in a TOML document. `fixable` issues (unknown sections
 * and keys) can be repaired by dropping the offending entry; the rest need a
 * human or agent to correct the value or syntax.
 */
export type TomlIssue = {
  kind:
    'syntax' | 'unknown-section' | 'not-a-table' | 'unknown-key' | 'wrong-type' | 'out-of-domain';
  message: string;
  fixable: boolean;
  /** Errors block apply; warnings are advisory (a value outside the known domain). */
  severity: 'error' | 'warning';
};

/** The result of validating a TOML document against the registry. */
export type TomlAnalysis = {
  /** Every valid setting the document declares, in registry order. */
  desired: DesiredSetting[];
  issues: TomlIssue[];
};

/**
 * Validate a battlestation TOML document against the registry, collecting
 * every issue rather than stopping at the first. Valid settings are returned
 * even when other entries have problems.
 */
export function analyzeToml(text: string): TomlAnalysis {
  const desired: DesiredSetting[] = [];
  const issues: TomlIssue[] = [];

  let document: Record<string, unknown>;
  try {
    document = parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { desired, issues: [{ kind: 'syntax', message, fixable: false, severity: 'error' }] };
  }

  for (const [section, table] of Object.entries(document)) {
    if (!sectionOrder.includes(section)) {
      issues.push({
        kind: 'unknown-section',
        message: `Unknown section [${section}]`,
        fixable: true,
        severity: 'error',
      });
      continue;
    }
    if (!isTable(table)) {
      issues.push({
        kind: 'not-a-table',
        message: `[${section}] must be a table of settings`,
        fixable: false,
        severity: 'error',
      });
      continue;
    }

    analyzeSection(section, table, desired, issues);
  }

  return { desired: sortByRegistryOrder(desired), issues };
}

function analyzeSection(
  section: string,
  table: Record<string, unknown>,
  desired: DesiredSetting[],
  issues: TomlIssue[],
): void {
  for (const [key, raw] of Object.entries(table)) {
    const definition = findDefinition(section, key);
    if (definition === undefined) {
      issues.push({
        kind: 'unknown-key',
        message: `Unknown setting ${section}.${key}`,
        fixable: true,
        severity: 'error',
      });
      continue;
    }

    try {
      const value = coerce(definition, raw);
      desired.push({ definition, value });

      const warning = domainWarning(definition, value);
      if (warning) {
        issues.push({
          kind: 'out-of-domain',
          message: warning,
          fixable: false,
          severity: 'warning',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ kind: 'wrong-type', message, fixable: false, severity: 'error' });
    }
  }
}

/**
 * Parse a battlestation TOML document into desired settings, throwing on
 * the first problem. Use {@link analyzeToml} to collect every issue instead.
 */
export function parseToml(text: string): DesiredSetting[] {
  const { desired, issues } = analyzeToml(text);
  const firstError = issues.find((issue) => issue.severity === 'error');
  if (firstError) throw new TypeError(firstError.message);

  return desired;
}

function domainWarning(definition: SettingDefinition, value: SettingValue): string | undefined {
  const address = `${definition.section}.${definition.key}`;

  if (definition.choices && !definition.choices.some((choice) => choice.value === value)) {
    return `${address} = ${describeScalar(value)} is not one of the known values`;
  }
  if (definition.range && typeof value === 'number') {
    const { min, max } = definition.range;
    if (value < min || value > max) {
      return `${address} = ${describeScalar(value)} is outside the expected range ${min}–${max}`;
    }
  }

  return undefined;
}

/**
 * The leading comment block of a TOML document (without the `#` markers),
 * so a rewrite can preserve the original header. Falls back to a minimal
 * header when the document has none.
 */
export function extractHeader(text: string): string[] {
  const header: string[] = [];

  for (const line of text.split('\n')) {
    if (line.startsWith('#')) {
      header.push(line.replace(/^#\s?/, ''));
    } else if (line.trim() === '' && header.length > 0) {
      header.push('');
    } else {
      break;
    }
  }

  while (header.at(-1) === '') header.pop();

  return header.length > 0 ? header : ['battlestation — macOS system preferences snapshot'];
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortByRegistryOrder(desired: DesiredSetting[]): DesiredSetting[] {
  return desired.toSorted(
    (a, b) => registry.indexOf(a.definition) - registry.indexOf(b.definition),
  );
}
