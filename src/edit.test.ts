import { describe, expect, it } from 'bun:test';

import {
  parseValueLiteral,
  readFileValues,
  resolveAddress,
  setValueInFile,
  unsetValueInFile,
} from './edit.js';
import { findDefinition } from './settings/registry.js';

const iconSize = findDefinition('dock', 'icon-size')!;
const autoHide = findDefinition('dock', 'auto-hide')!;
const position = findDefinition('dock', 'position')!;
const autoHideDelay = findDefinition('dock', 'auto-hide-delay')!;

describe('resolveAddress', () => {
  it('resolves section.key addresses', () => {
    expect(resolveAddress('dock.icon-size')).toBe(iconSize);
    expect(resolveAddress('hot-corners.top-left-action')?.defaultsKey).toBe('wvous-tl-corner');
  });

  it('returns undefined for malformed or unknown addresses', () => {
    expect(resolveAddress('icon-size')).toBeUndefined();
    expect(resolveAddress('dock.nope')).toBeUndefined();
    expect(resolveAddress('nope.icon-size')).toBeUndefined();
  });
});

describe('parseValueLiteral', () => {
  it('parses each setting type from a command-line string', () => {
    expect(parseValueLiteral(autoHide, 'true')).toBe(true);
    expect(parseValueLiteral(autoHide, 'false')).toBe(false);
    expect(parseValueLiteral(iconSize, '48')).toBe(48);
    expect(parseValueLiteral(autoHideDelay, '0.15')).toBe(0.15);
    expect(parseValueLiteral(position, 'left')).toBe('left');
  });

  it('parses plist literals as JSON', () => {
    const shortcuts = findDefinition('shortcuts', 'keyboard-shortcuts')!;

    expect(parseValueLiteral(shortcuts, '{"64": {"enabled": false}}')).toEqual({
      '64': { enabled: false },
    });
    expect(() => parseValueLiteral(shortcuts, 'nope')).toThrow(
      'shortcuts.keyboard-shortcuts must be valid JSON, got "nope"',
    );
  });

  it('rejects literals that do not fit the type', () => {
    expect(() => parseValueLiteral(autoHide, 'yes')).toThrow(
      'dock.auto-hide must be true or false, got "yes"',
    );
    expect(() => parseValueLiteral(iconSize, '48.5')).toThrow(
      'dock.icon-size must be an integer, got "48.5"',
    );
    expect(() => parseValueLiteral(autoHideDelay, 'fast')).toThrow(
      'dock.auto-hide-delay must be a number, got "fast"',
    );
  });
});

describe('file editing', () => {
  const text = '# header\n\n[dock]\nicon-size = 48\n';

  it('reads file values keyed by definition', () => {
    expect(readFileValues(text)).toEqual(new Map([[iconSize, 48]]));
  });

  it('sets a value and re-renders canonically with the header preserved', () => {
    const updated = setValueInFile(text, autoHide, true);

    expect(updated).toStartWith('# header\n');
    expect(updated).toContain('auto-hide = true');
    expect(updated).toContain('icon-size = 48');
    expect(updated).toContain('# Dock icon size. Range: 16–128 px.');
  });

  it('unsets a value back to a commented-out key', () => {
    const updated = unsetValueInFile(text, iconSize);

    expect(updated).not.toContain('icon-size = 48');
    expect(updated).toContain('# icon-size is not set; macOS uses its built-in default.');
  });
});
