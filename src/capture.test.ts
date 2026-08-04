import { describe, expect, it } from 'bun:test';

import { buildHeader, captureSettings, captureToml } from './capture.js';
import type { CommandRunner } from './defaults.js';
import { registry } from './settings/registry.js';

/** A fake system where only Dock icon size is set. */
const fakeRun: CommandRunner = async (command, args) => {
  if (command === 'sw_vers') return { stdout: '26.5.2\n', exitCode: 0 };
  if (args[1] === 'com.apple.dock' && args[2] === 'tilesize') {
    return { stdout: '48\n', exitCode: 0 };
  }

  return { stdout: '', exitCode: 1 };
};

const failingRun: CommandRunner = async () => ({ stdout: '', exitCode: 1 });

describe('captureSettings', () => {
  it('captures a value for every registered setting', async () => {
    const captured = await captureSettings(fakeRun);

    expect(captured).toHaveLength(registry.length);

    const iconSize = captured.find((entry) => entry.definition.defaultsKey === 'tilesize');
    expect(iconSize?.value).toBe(48);

    const autoHide = captured.find((entry) => entry.definition.defaultsKey === 'autohide');
    expect(autoHide?.value).toBeUndefined();
  });
});

describe('buildHeader', () => {
  it('includes the macOS version when sw_vers succeeds', async () => {
    const header = await buildHeader(fakeRun, new Date('2026-08-04T00:00:00Z'));

    expect(header[1]).toBe('Captured 2026-08-04T00:00:00.000Z on macOS 26.5.2.');
  });

  it('omits the macOS version when sw_vers fails', async () => {
    const header = await buildHeader(failingRun, new Date('2026-08-04T00:00:00Z'));

    expect(header[1]).toBe('Captured 2026-08-04T00:00:00.000Z.');
  });
});

describe('captureToml', () => {
  it('renders a complete annotated document', async () => {
    const toml = await captureToml(fakeRun, new Date('2026-08-04T00:00:00Z'));

    expect(toml).toContain('# battlestation — macOS system preferences snapshot');
    expect(toml).toContain('icon-size = 48');
    expect(toml).toContain('# auto-hide is not set; macOS uses its built-in default.');
  });
});
