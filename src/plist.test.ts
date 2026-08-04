import { describe, expect, it } from 'bun:test';

import { isPlistValue, parseJsonPlist, plistEquals, toPlistXml } from './plist.js';

describe('toPlistXml', () => {
  it('serializes scalars, arrays, and dictionaries', () => {
    expect(toPlistXml(true)).toBe('<true/>');
    expect(toPlistXml(false)).toBe('<false/>');
    expect(toPlistXml(42)).toBe('<integer>42</integer>');
    expect(toPlistXml(0.5)).toBe('<real>0.5</real>');
    expect(toPlistXml('hi')).toBe('<string>hi</string>');
    expect(toPlistXml([1, 'a'])).toBe('<array><integer>1</integer><string>a</string></array>');
    expect(toPlistXml({ enabled: true, parameters: [65535] })).toBe(
      '<dict><key>enabled</key><true/><key>parameters</key><array><integer>65535</integer></array></dict>',
    );
  });

  it('escapes XML special characters in strings and keys', () => {
    expect(toPlistXml('a<b&c>d')).toBe('<string>a&lt;b&amp;c&gt;d</string>');
    expect(toPlistXml({ 'k<': 'v&' })).toBe('<dict><key>k&lt;</key><string>v&amp;</string></dict>');
  });
});

describe('isPlistValue and parseJsonPlist', () => {
  it('accepts JSON without nulls and rejects nulls', () => {
    expect(isPlistValue({ a: [1, 'two', true] })).toBe(true);
    expect(isPlistValue(null)).toBe(false);
    expect(isPlistValue({ a: null })).toBe(false);
    expect(isPlistValue([null])).toBe(false);

    expect(parseJsonPlist('{"a": 1}')).toEqual({ a: 1 });
    expect(() => parseJsonPlist('{"a": null}')).toThrow('plists cannot hold');
    expect(() => parseJsonPlist('not json')).toThrow();
  });
});

describe('plistEquals', () => {
  it('compares scalars strictly', () => {
    expect(plistEquals(1, 1)).toBe(true);
    expect(plistEquals(1, '1')).toBe(false);
    expect(plistEquals(undefined, undefined)).toBe(true);
    expect(plistEquals(1, undefined)).toBe(false);
  });

  it('compares arrays by position and dictionaries by key set', () => {
    expect(plistEquals([1, { a: 2 }], [1, { a: 2 }])).toBe(true);
    expect(plistEquals([1, 2], [2, 1])).toBe(false);
    expect(plistEquals([1], [1, 2])).toBe(false);
    expect(plistEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(plistEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(plistEquals({ a: 1 }, { a: 2 })).toBe(false);
    expect(plistEquals({ a: 1 }, [1])).toBe(false);
    expect(plistEquals([1], { a: 1 })).toBe(false);
  });
});
