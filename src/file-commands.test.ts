import { describe, expect, it } from 'bun:test';

import { makeEnvironment } from '../test/cli-helpers.js';
import { run } from './index.js';

function parseJsonReports(text: string): Record<string, unknown>[] {
  return JSON.parse(text);
}

describe('doctor', () => {
  it('reports a missing file', async () => {
    const { environment, logs } = makeEnvironment(new Map());

    expect(await run(['doctor', '--file', 'missing.toml'], environment)).toBe(1);
    expect(logs[0]).toBe('Cannot read missing.toml.');
  });

  it('reports a healthy file with set and unset counts', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = true\nicon-size = 48\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['doctor', '--file', 'settings.toml'], environment)).toBe(0);
    expect(logs[0]).toContain('settings.toml is healthy: 2 setting(s) set');
  });

  it('lists issues and suggests --fix when everything is fixable', async () => {
    const files = new Map([['settings.toml', '[dock]\nbogus = 1\nauto-hide = true\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['doctor', '--file', 'settings.toml'], environment)).toBe(1);
    expect(logs[0]).toBe('1 problem(s) in settings.toml:');
    expect(logs[1]).toBe('  [fixable] Unknown setting dock.bogus');
    expect(logs.at(-1)).toContain('doctor --fix');
  });

  it('does not suggest --fix for manual-only issues', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = 1\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['doctor', '--file', 'settings.toml'], environment)).toBe(1);
    expect(logs[1]).toBe('  [manual] dock.auto-hide must be true or false');
    expect(logs.join('\n')).not.toContain('doctor --fix');
  });

  it('--fix removes unknown entries and rewrites the file canonically', async () => {
    const files = new Map([
      ['settings.toml', '# my header\n\n[bogus]\nfoo = 1\n\n[dock]\nauto-hide = true\n'],
    ]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['doctor', '--fix', '--file', 'settings.toml'], environment)).toBe(0);
    expect(logs.at(-1)).toContain('Removed 1 unknown entry');

    const repaired = files.get('settings.toml')!;
    expect(repaired).toStartWith('# my header\n');
    expect(repaired).toContain('auto-hide = true');
    expect(repaired).not.toContain('bogus');
  });

  it('--fix refuses when manual issues remain', async () => {
    const files = new Map([['settings.toml', '[dock]\nbogus = 1\nauto-hide = 1\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['doctor', '--fix', '--file', 'settings.toml'], environment)).toBe(1);
    expect(logs.at(-1)).toContain('Cannot auto-fix');
    expect(files.get('settings.toml')).toContain('bogus');
  });
});

describe('doctor warnings', () => {
  it('reports advisory warnings and exits 0 when nothing blocks', async () => {
    const files = new Map([['settings.toml', '[dock]\nicon-size = 4096\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['doctor', '--file', 'settings.toml'], environment)).toBe(0);
    expect(logs[0]).toBe('  [warning] dock.icon-size = 4096 is outside the expected range 16–128');
    expect(logs.at(-1)).toContain('advisory only');
  });

  it('reports errors and warnings together and exits 1', async () => {
    const files = new Map([['settings.toml', '[dock]\nbogus = 1\nicon-size = 4096\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['doctor', '--file', 'settings.toml'], environment)).toBe(1);
    expect(logs.join('\n')).toContain('[fixable] Unknown setting dock.bogus');
    expect(logs.join('\n')).toContain('[warning] dock.icon-size = 4096');
  });

  it('--fix has nothing to do for warnings-only files', async () => {
    const files = new Map([['settings.toml', '[dock]\nicon-size = 4096\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['doctor', '--fix', '--file', 'settings.toml'], environment)).toBe(0);
    expect(logs.at(-1)).toContain('Nothing auto-fixable');
    expect(files.get('settings.toml')).toContain('icon-size = 4096');
  });
});

describe('list and get', () => {
  it('list prints every registered setting with file and system values', async () => {
    const files = new Map([['settings.toml', '[dock]\nicon-size = 48\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['list', '--file', 'settings.toml'], environment)).toBe(0);
    expect(logs.length).toBeGreaterThan(50);
    expect(logs.find((line) => line.includes('dock.auto-hide'))).toContain(
      'file=(not set)  system=true',
    );
    expect(logs.find((line) => line.includes('dock.icon-size'))).toContain(
      'file=48  system=(not set)',
    );
  });

  it('list --json prints machine-readable reports', async () => {
    const files = new Map([['settings.toml', '[dock]\nicon-size = 48\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['list', '--json', '--file', 'settings.toml'], environment)).toBe(0);

    const reports = parseJsonReports(logs[0]!);
    const autoHide = reports.find((report) => report['address'] === 'dock.auto-hide');
    expect(autoHide).toMatchObject({
      type: 'boolean',
      file: null,
      system: true,
      label: 'Auto Hide',
      restart: 'Dock',
    });
    expect(autoHide!['description']).toContain('hide the Dock');

    const position = reports.find((report) => report['address'] === 'dock.position');
    expect(position!['choices']).toEqual([
      { value: 'left', label: 'Left' },
      { value: 'bottom', label: 'Bottom' },
      { value: 'right', label: 'Right' },
    ]);

    const iconSize = reports.find((report) => report['address'] === 'dock.icon-size');
    expect(iconSize!['range']).toEqual({ min: 16, max: 128, unit: 'px' });

    const hotkeys = reports.find((report) => report['address'] === 'shortcuts.keyboard-shortcuts');
    expect(hotkeys!['risk']).toBe('caution');
  });

  it('list reports an invalid file and points at doctor', async () => {
    const files = new Map([['settings.toml', '[dock]\nbogus = 1\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['list', '--file', 'settings.toml'], environment)).toBe(1);
    expect(logs[0]).toBe('settings.toml is invalid: Unknown setting dock.bogus');
    expect(logs[1]).toContain('doctor');
  });

  it('get shows one setting with description, file, and system values', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = false\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['get', 'dock.auto-hide', '--file', 'settings.toml'], environment)).toBe(0);
    expect(logs[0]).toContain('dock.auto-hide (boolean) —');
    expect(logs[1]).toBe('  file:   false');
    expect(logs[2]).toBe('  system: true');
  });

  it('get --json prints a machine-readable report even without a file', async () => {
    const { environment, logs } = makeEnvironment(new Map());

    expect(await run(['get', 'dock.auto-hide', '--json'], environment)).toBe(0);
    expect(JSON.parse(logs[0]!)).toMatchObject({
      address: 'dock.auto-hide',
      file: null,
      system: true,
    });
  });

  it('get requires a known address', async () => {
    const { environment, logs } = makeEnvironment(new Map());

    expect(await run(['get'], environment)).toBe(1);
    expect(logs[0]).toContain('Usage: battlestation get');

    expect(await run(['get', 'dock.nope'], environment)).toBe(1);
    expect(logs.at(-2)).toBe('Unknown setting "dock.nope".');
  });
});

describe('set and unset', () => {
  it('set updates the file and reminds about apply', async () => {
    const files = new Map([['settings.toml', '# header\n\n[dock]\nicon-size = 48\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(
      await run(['set', 'dock.auto-hide-delay', '0.15', '--file', 'settings.toml'], environment),
    ).toBe(0);
    expect(logs[0]).toBe('Set dock.auto-hide-delay = 0.15 in settings.toml.');
    expect(logs[1]).toContain('battlestation apply');
    expect(files.get('settings.toml')).toContain('auto-hide-delay = 0.15');
    expect(files.get('settings.toml')).toContain('icon-size = 48');
  });

  it('set validates its arguments, address, value, and file', async () => {
    const files = new Map([
      ['settings.toml', '[dock]\nicon-size = 48\n'],
      ['broken.toml', '[dock]\nbogus = 1\n'],
    ]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['set', 'dock.icon-size'], environment)).toBe(1);
    expect(logs.at(-1)).toContain('Usage: battlestation set');

    expect(await run(['set', 'dock.nope', '1'], environment)).toBe(1);
    expect(logs.at(-2)).toBe('Unknown setting "dock.nope".');

    expect(
      await run(['set', 'dock.icon-size', 'big', '--file', 'settings.toml'], environment),
    ).toBe(1);
    expect(logs.at(-1)).toBe('dock.icon-size must be an integer, got "big"');

    expect(await run(['set', 'dock.icon-size', '48', '--file', 'missing.toml'], environment)).toBe(
      1,
    );
    expect(logs.at(-2)).toBe('Cannot read missing.toml.');

    expect(await run(['set', 'dock.icon-size', '48', '--file', 'broken.toml'], environment)).toBe(
      1,
    );
    expect(logs.at(-2)).toBe('broken.toml is invalid: Unknown setting dock.bogus');
  });

  it('unset removes the value and explains the apply consequence', async () => {
    const files = new Map([['settings.toml', '[dock]\nicon-size = 48\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['unset', 'dock.icon-size', '--file', 'settings.toml'], environment)).toBe(0);
    expect(logs[0]).toBe('Unset dock.icon-size in settings.toml.');
    expect(logs[1]).toContain('macOS default');
    expect(files.get('settings.toml')).not.toContain('icon-size = 48');
  });

  it('unset validates its arguments, address, and file', async () => {
    const files = new Map([['broken.toml', '[dock]\nbogus = 1\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['unset'], environment)).toBe(1);
    expect(logs.at(-1)).toContain('Usage: battlestation unset');

    expect(await run(['unset', 'dock.nope'], environment)).toBe(1);
    expect(logs.at(-2)).toBe('Unknown setting "dock.nope".');

    expect(await run(['unset', 'dock.icon-size', '--file', 'missing.toml'], environment)).toBe(1);
    expect(logs.at(-2)).toBe('Cannot read missing.toml.');

    expect(await run(['unset', 'dock.icon-size', '--file', 'broken.toml'], environment)).toBe(1);
    expect(logs.at(-2)).toBe('broken.toml is invalid: Unknown setting dock.bogus');
  });
});
