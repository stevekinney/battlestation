import { describe, expect, it } from 'bun:test';

import type { CommandRunner } from './defaults.js';
import {
  deleteSetting,
  parseDefaultsOutput,
  readSetting,
  runCommand,
  writeArguments,
  writeSetting,
} from './defaults.js';
import { plistPath } from './plist.js';
import type { SettingDefinition } from './settings/definition.js';

const booleanSetting: SettingDefinition = {
  section: 'dock',
  key: 'auto-hide',
  description: 'test',
  domain: 'com.apple.dock',
  defaultsKey: 'autohide',
  type: 'boolean',
};

const booleanOnRun: CommandRunner = async () => ({ stdout: '1\n', exitCode: 0 });
const failingRun: CommandRunner = async () => ({ stdout: '', exitCode: 1 });

describe('runCommand', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await runCommand('/bin/echo', ['hello']);

    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  it('reports a nonzero exit code without throwing', async () => {
    const result = await runCommand('/usr/bin/false', []);

    expect(result.exitCode).toBe(1);
  });
});

describe('parseDefaultsOutput', () => {
  it('parses booleans from 0/1 and true/false', () => {
    expect(parseDefaultsOutput('1\n', 'boolean')).toBe(true);
    expect(parseDefaultsOutput('true\n', 'boolean')).toBe(true);
    expect(parseDefaultsOutput('0\n', 'boolean')).toBe(false);
    expect(parseDefaultsOutput('false\n', 'boolean')).toBe(false);
  });

  it('parses integers, floats, and strings', () => {
    expect(parseDefaultsOutput('15\n', 'integer')).toBe(15);
    expect(parseDefaultsOutput('0.2\n', 'float')).toBe(0.2);
    expect(parseDefaultsOutput('Nlsv\n', 'string')).toBe('Nlsv');
  });
});

describe('readSetting', () => {
  it('returns the parsed value when the key is set', async () => {
    expect(await readSetting(booleanSetting, booleanOnRun)).toBe(true);
  });

  it('returns undefined when the key is not set', async () => {
    expect(await readSetting(booleanSetting, failingRun)).toBeUndefined();
  });
});

describe('writeArguments', () => {
  it('produces the right type flag for each setting type', () => {
    expect(writeArguments(booleanSetting, true)).toEqual(['-bool', 'true']);
    expect(writeArguments(booleanSetting, false)).toEqual(['-bool', 'false']);
    expect(writeArguments({ ...booleanSetting, type: 'integer' }, 42)).toEqual(['-int', '42']);
    expect(writeArguments({ ...booleanSetting, type: 'float' }, 0.5)).toEqual(['-float', '0.5']);
    expect(writeArguments({ ...booleanSetting, type: 'string' }, 'left')).toEqual([
      '-string',
      'left',
    ]);
  });
});

describe('perHost settings', () => {
  const perHostSetting: SettingDefinition = {
    section: 'screen-saver',
    key: 'idle-time',
    description: 'test',
    domain: 'com.apple.screensaver',
    defaultsKey: 'idleTime',
    type: 'integer',
    perHost: true,
  };

  it('passes -currentHost on read, write, and delete', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = async (_, args) => {
      calls.push(args);
      return { stdout: '300\n', exitCode: 0 };
    };

    expect(await readSetting(perHostSetting, run)).toBe(300);
    await writeSetting(perHostSetting, 600, run);
    await deleteSetting(perHostSetting, run);

    expect(calls).toEqual([
      ['-currentHost', 'read', 'com.apple.screensaver', 'idleTime'],
      ['-currentHost', 'write', 'com.apple.screensaver', 'idleTime', '-int', '600'],
      ['-currentHost', 'delete', 'com.apple.screensaver', 'idleTime'],
    ]);
  });
});

describe('plist settings', () => {
  const plistSetting: SettingDefinition = {
    section: 'shortcuts',
    key: 'keyboard-shortcuts',
    description: 'test',
    domain: 'com.apple.symbolichotkeys',
    defaultsKey: 'AppleSymbolicHotKeys',
    type: 'plist',
  };

  it('reads structured values from the plist file via plutil', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = async (command, args) => {
      calls.push([command, ...args]);
      return { stdout: '{"64": {"enabled": true}}', exitCode: 0 };
    };

    expect(await readSetting(plistSetting, run)).toEqual({ '64': { enabled: true } });
    expect(calls[0]![0]).toBe('plutil');
    expect(calls[0]).toContain('AppleSymbolicHotKeys');
    expect(calls[0]!.at(-1)).toBe(plistPath('com.apple.symbolichotkeys'));
  });

  it('returns undefined when the key or file is missing', async () => {
    expect(await readSetting(plistSetting, failingRun)).toBeUndefined();
  });

  it('writes structured values as an XML plist literal', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = async (_, args) => {
      calls.push(args);
      return { stdout: '', exitCode: 0 };
    };

    await writeSetting(plistSetting, { '64': { enabled: false } }, run);

    expect(calls).toEqual([
      [
        'write',
        'com.apple.symbolichotkeys',
        'AppleSymbolicHotKeys',
        '<dict><key>64</key><dict><key>enabled</key><false/></dict></dict>',
      ],
    ]);
  });

  it('maps NSGlobalDomain to the .GlobalPreferences plist', () => {
    expect(plistPath('NSGlobalDomain')).toEndWith('/Library/Preferences/.GlobalPreferences.plist');
    expect(plistPath('com.apple.dock')).toEndWith('/Library/Preferences/com.apple.dock.plist');
  });

  it('rejects structured values for scalar settings', () => {
    expect(() => writeArguments(booleanSetting, { nope: true })).toThrow(
      'autohide is scalar but received a structured value',
    );
  });
});

describe('writeSetting', () => {
  it('writes to the primary domain and every mirror domain', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = async (_, args) => {
      calls.push(args);
      return { stdout: '', exitCode: 0 };
    };

    const mirrored: SettingDefinition = {
      ...booleanSetting,
      mirrorDomains: ['com.apple.driver.AppleBluetoothMultitouch.trackpad'],
    };

    await writeSetting(mirrored, true, run);

    expect(calls).toEqual([
      ['write', 'com.apple.dock', 'autohide', '-bool', 'true'],
      ['write', 'com.apple.driver.AppleBluetoothMultitouch.trackpad', 'autohide', '-bool', 'true'],
    ]);
  });

  it('deletes from the primary domain and every mirror domain, tolerating absent keys', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = async (_, args) => {
      calls.push(args);
      return { stdout: '', exitCode: args[1] === 'com.apple.dock' ? 0 : 1 };
    };

    const mirrored: SettingDefinition = {
      ...booleanSetting,
      mirrorDomains: ['com.apple.driver.AppleBluetoothMultitouch.trackpad'],
    };

    await deleteSetting(mirrored, run);

    expect(calls).toEqual([
      ['delete', 'com.apple.dock', 'autohide'],
      ['delete', 'com.apple.driver.AppleBluetoothMultitouch.trackpad', 'autohide'],
    ]);
  });

  it('throws when defaults write fails', async () => {
    expect(writeSetting(booleanSetting, true, failingRun)).rejects.toThrow(
      'Failed to write com.apple.dock autohide',
    );
  });
});
