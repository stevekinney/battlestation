import { parseJsonPlist } from './plist.js';
import type { SettingDefinition, SettingValue } from './settings/definition.js';
import { findDefinition, registry } from './settings/registry.js';
import { extractHeader, parseToml, renderToml } from './toml.js';

/** Look up a setting by its `section.key` address, or undefined if unknown. */
export function resolveAddress(address: string): SettingDefinition | undefined {
  const separator = address.indexOf('.');
  if (separator === -1) return undefined;

  return findDefinition(address.slice(0, separator), address.slice(separator + 1));
}

/**
 * Parse a command-line value literal into the setting's declared type.
 * Throws with a human-readable message when the literal does not fit.
 */
export function parseValueLiteral(definition: SettingDefinition, raw: string): SettingValue {
  const address = `${definition.section}.${definition.key}`;

  if (definition.type === 'plist') {
    try {
      return parseJsonPlist(raw);
    } catch {
      throw new TypeError(`${address} must be valid JSON, got "${raw}"`);
    }
  }

  if (definition.type === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new TypeError(`${address} must be true or false, got "${raw}"`);
  }

  if (definition.type === 'integer') {
    if (!/^-?\d+$/.test(raw)) throw new TypeError(`${address} must be an integer, got "${raw}"`);
    return Number.parseInt(raw, 10);
  }

  if (definition.type === 'float') {
    const value = Number.parseFloat(raw);
    if (Number.isNaN(value)) throw new TypeError(`${address} must be a number, got "${raw}"`);
    return value;
  }

  return raw;
}

/** The values a TOML document assigns, keyed by setting definition. */
export function readFileValues(text: string): Map<SettingDefinition, SettingValue> {
  return new Map(parseToml(text).map((entry) => [entry.definition, entry.value]));
}

/**
 * Return the document with one setting added or updated, re-rendered in
 * canonical annotated form with the original header preserved.
 */
export function setValueInFile(
  text: string,
  definition: SettingDefinition,
  value: SettingValue,
): string {
  const values = readFileValues(text);
  values.set(definition, value);

  return renderFromValues(text, values);
}

/**
 * Return the document with one setting removed (back to a commented-out
 * key), re-rendered in canonical annotated form.
 */
export function unsetValueInFile(text: string, definition: SettingDefinition): string {
  const values = readFileValues(text);
  values.delete(definition);

  return renderFromValues(text, values);
}

function renderFromValues(
  originalText: string,
  values: Map<SettingDefinition, SettingValue>,
): string {
  return renderToml(
    registry.map((definition) => ({ definition, value: values.get(definition) })),
    extractHeader(originalText),
  );
}
