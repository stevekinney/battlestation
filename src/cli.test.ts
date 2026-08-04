import { describe, expect, it } from 'bun:test';

import { displayValue, settingLabel } from './cli.js';
import { findDefinition } from './settings/registry.js';

const shortcuts = findDefinition('shortcuts', 'keyboard-shortcuts')!;
const iconSize = findDefinition('dock', 'icon-size')!;

describe('settingLabel', () => {
  it('derives a label from the key and honors overrides', () => {
    expect(settingLabel(findDefinition('keyboard', 'key-repeat-rate')!)).toBe('Key Repeat Rate');
    expect(settingLabel(findDefinition('finder', 'posix-path-in-title')!)).toBe(
      'POSIX Path in Window Title',
    );
  });
});

describe('displayValue', () => {
  it('formats scalar settings as TOML literals', () => {
    expect(displayValue(48, iconSize)).toBe('48');
  });

  it('summarizes structured values instead of dumping them', () => {
    expect(displayValue({ a: 1, b: 2 }, shortcuts)).toBe('(structured: 2 entries)');
    expect(displayValue({ a: 1 }, shortcuts)).toBe('(structured: 1 entry)');
    expect(displayValue([1, 2, 3], shortcuts)).toBe('(structured: 3 item(s))');
    expect(displayValue('scalar', shortcuts)).toBe('(structured: "scalar")');
  });
});
