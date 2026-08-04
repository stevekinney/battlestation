import { homedir } from 'node:os';
import { join } from 'node:path';

import type { PlistValue } from './settings/definition.js';

/** The on-disk plist path for a domain, used for structured-value reads. */
export function plistPath(domain: string): string {
  const filename = domain === 'NSGlobalDomain' ? '.GlobalPreferences' : domain;

  return join(homedir(), 'Library', 'Preferences', `${filename}.plist`);
}

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Serialize a structured value as an XML property-list fragment, the format
 * `defaults write <domain> <key> '<fragment>'` accepts for non-scalar
 * values. Integers become `<integer>`, other numbers `<real>`.
 */
export function toPlistXml(value: PlistValue): string {
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? `<integer>${value}</integer>` : `<real>${value}</real>`;
  }
  if (typeof value === 'string') return `<string>${escapeXml(value)}</string>`;
  if (Array.isArray(value)) {
    return `<array>${value.map((entry) => toPlistXml(entry)).join('')}</array>`;
  }

  const entries = Object.entries(value)
    .map(([key, entry]) => `<key>${escapeXml(key)}</key>${toPlistXml(entry)}`)
    .join('');

  return `<dict>${entries}</dict>`;
}

/** True when the value is representable as a property list (no null/undefined). */
export function isPlistValue(value: unknown): value is PlistValue {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true;
  }
  if (Array.isArray(value)) return value.every((entry) => isPlistValue(entry));
  // TOML dates parse to Date-like objects with no enumerable properties,
  // which would otherwise masquerade as empty dictionaries.
  if (value instanceof Date) return false;
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).every((entry) => isPlistValue(entry));
  }

  return false;
}

/** Parse JSON text into a property-list value, rejecting nulls. */
export function parseJsonPlist(text: string): PlistValue {
  const parsed: unknown = JSON.parse(text);
  if (!isPlistValue(parsed)) throw new TypeError('JSON contains null, which plists cannot hold');

  return parsed;
}

function arraysEqual(a: PlistValue[], b: PlistValue[]): boolean {
  if (a.length !== b.length) return false;

  return a.every((entry, index) => plistEquals(entry, b[index]));
}

function dictionariesEqual(a: Record<string, PlistValue>, b: Record<string, PlistValue>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;

  return aKeys.every((key) => plistEquals(a[key], b[key]));
}

/**
 * Structural equality for property-list values. Dictionaries compare by key
 * set regardless of order; arrays compare by position.
 */
export function plistEquals(a: PlistValue | undefined, b: PlistValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && arraysEqual(a, b);
  }

  return dictionariesEqual(a, b);
}
