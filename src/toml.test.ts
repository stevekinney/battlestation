import { describe, expect, it } from 'bun:test';

import { findDefinition, registry, sectionOrder } from './settings/registry.js';
import {
  analyzeToml,
  extractHeader,
  formatTomlValue,
  parseToml,
  renderToml,
  settingLegend,
} from './toml.js';

describe('registry', () => {
  it('has a unique section.key address for every setting', () => {
    const addresses = registry.map((setting) => `${setting.section}.${setting.key}`);

    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it('finds definitions by address and misses unknown ones', () => {
    expect(findDefinition('dock', 'auto-hide')?.defaultsKey).toBe('autohide');
    expect(findDefinition('dock', 'nope')).toBeUndefined();
  });
});

describe('formatTomlValue', () => {
  it('formats booleans, integers, floats, and strings as TOML literals', () => {
    expect(formatTomlValue(true, 'boolean')).toBe('true');
    expect(formatTomlValue(false, 'boolean')).toBe('false');
    expect(formatTomlValue(67, 'integer')).toBe('67');
    expect(formatTomlValue(0.2, 'float')).toBe('0.2');
    expect(formatTomlValue('left', 'string')).toBe('"left"');
  });

  it('keeps whole-number floats typed as floats', () => {
    expect(formatTomlValue(3, 'float')).toBe('3.0');
  });
});

describe('renderToml', () => {
  const captured = registry.map((definition) => ({
    definition,
    value: definition.section === 'dock' && definition.key === 'icon-size' ? 48 : undefined,
  }));

  it('renders every section, comments unset keys, and keeps header lines', () => {
    const toml = renderToml(captured, ['header line', '', 'second line']);

    expect(toml).toContain('# header line');
    expect(toml).toContain('\n\n# second line');
    expect(toml).toContain('[dock]');
    expect(toml).toContain('icon-size = 48');
    expect(toml).toContain('# auto-hide is not set; macOS uses its built-in default.');

    for (const section of sectionOrder) {
      expect(toml).toContain(`[${section}]`);
    }
  });

  it('round-trips through parseToml', () => {
    const desired = parseToml(renderToml(captured, []));

    expect(desired).toHaveLength(1);
    expect(desired[0]!.definition.defaultsKey).toBe('tilesize');
    expect(desired[0]!.value).toBe(48);
  });
});

describe('plist values in TOML', () => {
  const shortcuts = findDefinition('shortcuts', 'keyboard-shortcuts')!;

  it('renders structured values as pretty JSON in a multi-line literal string', () => {
    const value = { '64': { enabled: true, value: { parameters: [65535, 49] } } };
    const toml = renderToml([{ definition: shortcuts, value }], []);

    expect(toml).toContain("keyboard-shortcuts = '''");
    expect(toml).toContain('"enabled": true');

    const desired = parseToml(toml);
    expect(desired).toHaveLength(1);
    expect(desired[0]!.value).toEqual(value);
  });

  it('falls back to an escaped single-line string when the JSON contains triple quotes', () => {
    expect(formatTomlValue("'''", 'plist')).toBe(String.raw`"\"'''\""`);
  });

  it('rejects non-string and invalid-JSON plist values', () => {
    expect(() => parseToml('[shortcuts]\nkeyboard-shortcuts = 1')).toThrow(
      'shortcuts.keyboard-shortcuts must be a JSON string',
    );
    expect(() => parseToml('[shortcuts]\nkeyboard-shortcuts = "not json"')).toThrow(
      'shortcuts.keyboard-shortcuts must contain valid JSON',
    );
  });
});

describe('settingLegend', () => {
  it('appends generated legends for choices, ranges, and defaults', () => {
    expect(settingLegend(findDefinition('dock', 'position')!)).toBe(
      'Which screen edge the Dock lives on. Values: left = Left, bottom = Bottom, right = Right.',
    );
    expect(settingLegend(findDefinition('dock', 'icon-size')!)).toBe(
      'Dock icon size. Range: 16–128 px.',
    );
    expect(settingLegend(findDefinition('system', 'alert-volume')!)).toBe(
      'Alert (beep) volume. Range: 0–1.',
    );
    expect(settingLegend(findDefinition('dock', 'auto-hide-animation-duration')!)).toBe(
      'Seconds the Dock show/hide animation takes; lower feels snappier. macOS default: 0.5.',
    );
    expect(settingLegend(findDefinition('dock', 'auto-hide')!)).toBe(
      'Automatically hide the Dock until the pointer reaches the screen edge.',
    );
  });
});

describe('domain warnings', () => {
  it('flags values outside choices or range as warnings, keeping the setting', () => {
    const { desired, issues } = analyzeToml(
      '[dock]\nposition = "top"\nicon-size = 4096\nauto-hide = true\n',
    );

    expect(issues).toEqual([
      {
        kind: 'out-of-domain',
        message: 'dock.position = top is not one of the known values',
        fixable: false,
        severity: 'warning',
      },
      {
        kind: 'out-of-domain',
        message: 'dock.icon-size = 4096 is outside the expected range 16–128',
        fixable: false,
        severity: 'warning',
      },
    ]);
    expect(desired).toHaveLength(3);
  });

  it('does not warn for in-domain values, and parseToml tolerates warnings', () => {
    expect(analyzeToml('[dock]\nposition = "left"\nicon-size = 48\n').issues).toEqual([]);
    expect(parseToml('[dock]\nicon-size = 4096\n')).toHaveLength(1);
  });
});

describe('analyzeToml', () => {
  it('collects every issue instead of stopping at the first', () => {
    const { desired, issues } = analyzeToml(
      '[nonsense]\nfoo = 1\n\n[dock]\nbogus = 2\nauto-hide = 1\nicon-size = 48\n',
    );

    expect(issues).toEqual([
      {
        kind: 'unknown-section',
        message: 'Unknown section [nonsense]',
        fixable: true,
        severity: 'error',
      },
      {
        kind: 'unknown-key',
        message: 'Unknown setting dock.bogus',
        fixable: true,
        severity: 'error',
      },
      {
        kind: 'wrong-type',
        message: 'dock.auto-hide must be true or false',
        fixable: false,
        severity: 'error',
      },
    ]);
    expect(desired).toHaveLength(1);
    expect(desired[0]!.value).toBe(48);
  });

  it('reports syntax errors without valid settings', () => {
    const { desired, issues } = analyzeToml('[dock\nicon-size = 48\n');

    expect(desired).toHaveLength(0);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe('syntax');
    expect(issues[0]!.fixable).toBe(false);
  });
});

describe('extractHeader', () => {
  it('extracts the leading comment block without the # markers', () => {
    const header = extractHeader('# first\n#\n# second\n\n[dock]\nicon-size = 48\n');

    expect(header).toEqual(['first', '', 'second']);
  });

  it('falls back to a minimal header when the document has none', () => {
    expect(extractHeader('[dock]\nicon-size = 48\n')).toEqual([
      'battlestation — macOS system preferences snapshot',
    ]);
  });
});

describe('parseToml', () => {
  it('parses all value types and sorts by registry order', () => {
    const desired = parseToml(
      [
        '[finder]',
        'show-path-bar = true',
        '[dock]',
        'auto-hide-delay = 0.0',
        'icon-size = 48',
        'position = "left"',
      ].join('\n'),
    );

    expect(desired.map((entry) => `${entry.definition.section}.${entry.definition.key}`)).toEqual([
      'dock.auto-hide-delay',
      'dock.icon-size',
      'dock.position',
      'finder.show-path-bar',
    ]);
  });

  it('rejects unknown sections', () => {
    expect(() => parseToml('[nonsense]\nfoo = 1')).toThrow('Unknown section [nonsense]');
  });

  it('rejects non-table sections', () => {
    expect(() => parseToml('dock = 1')).toThrow('[dock] must be a table of settings');
  });

  it('rejects unknown keys', () => {
    expect(() => parseToml('[dock]\nfoo = 1')).toThrow('Unknown setting dock.foo');
  });

  it('rejects values whose type does not match the setting', () => {
    expect(() => parseToml('[dock]\nauto-hide = 1')).toThrow(
      'dock.auto-hide must be true or false',
    );
    expect(() => parseToml('[dock]\nicon-size = "big"')).toThrow('dock.icon-size must be a number');
    expect(() => parseToml('[dock]\nposition = 1')).toThrow('dock.position must be a string');
  });
});
