import { describe, expect, it } from 'bun:test';

import { applyChanges, diffSettings } from './apply.js';
import type { PendingChange } from './apply.js';
import type { CommandRunner } from './defaults.js';
import type { SettingDefinition } from './settings/definition.js';
import { findDefinition } from './settings/registry.js';
import type { DesiredSetting } from './toml.js';

function definitionFor(section: string, key: string): SettingDefinition {
  const definition = findDefinition(section, key);
  if (definition === undefined) throw new Error(`Unknown setting ${section}.${key}`);

  return definition;
}

function desired(section: string, key: string, value: boolean | number | string): DesiredSetting {
  return { definition: definitionFor(section, key), value };
}

function change(
  section: string,
  key: string,
  current: boolean | number | string | undefined,
  target: boolean | number | string | undefined,
): PendingChange {
  return { definition: definitionFor(section, key), current, target };
}

/** A fake system where Dock icon size and auto-hide are set. */
const fakeRun: CommandRunner = async (_, args) => {
  if (args[2] === 'tilesize') return { stdout: '48\n', exitCode: 0 };
  if (args[2] === 'autohide') return { stdout: '1\n', exitCode: 0 };

  return { stdout: '', exitCode: 1 };
};

const succeedingRun: CommandRunner = async () => ({ stdout: '', exitCode: 0 });

describe('diffSettings', () => {
  it('reports differing and unset settings as writes, and skips matches', async () => {
    const changes = await diffSettings(
      [
        desired('dock', 'icon-size', 48),
        desired('dock', 'auto-hide', false),
        desired('finder', 'show-path-bar', true),
      ],
      fakeRun,
    );

    expect(changes).toEqual([
      change('dock', 'auto-hide', true, false),
      change('finder', 'show-path-bar', undefined, true),
    ]);
  });

  it('reports settings absent from the TOML but set on the system as deletions', async () => {
    const changes = await diffSettings([desired('dock', 'icon-size', 48)], fakeRun);

    expect(changes).toEqual([change('dock', 'auto-hide', true, undefined)]);
  });
});

describe('applyChanges', () => {
  it('writes and deletes changes, restarts each affected process once, and flags logout', async () => {
    const commands: string[][] = [];
    const run: CommandRunner = async (command, args) => {
      commands.push([command, ...args]);
      return { stdout: '', exitCode: 0 };
    };

    const result = await applyChanges(
      [
        change('dock', 'auto-hide', undefined, true),
        change('dock', 'icon-size', 48, undefined),
        change('keyboard', 'key-repeat-rate', 2, 1),
      ],
      run,
    );

    expect(result.restarted).toEqual(['Dock']);
    expect(result.requiresLogout).toBe(true);
    expect(commands.filter((call) => call[0] === 'killall')).toEqual([['killall', 'Dock']]);
    expect(commands).toContainEqual([
      'defaults',
      'write',
      'com.apple.dock',
      'autohide',
      '-bool',
      'true',
    ]);
    expect(commands).toContainEqual(['defaults', 'delete', 'com.apple.dock', 'tilesize']);
  });

  it('reports each change through the onApplied callback as it lands', async () => {
    const applied: string[] = [];

    await applyChanges(
      [change('dock', 'auto-hide', undefined, true), change('dock', 'icon-size', 48, undefined)],
      succeedingRun,
      (entry) => applied.push(entry.definition.key),
    );

    expect(applied).toEqual(['auto-hide', 'icon-size']);
  });

  it('needs no restart or logout when the changed settings need none', async () => {
    const result = await applyChanges(
      [change('system', 'sidebar-icon-size', undefined, 2)],
      succeedingRun,
    );

    expect(result.restarted).toEqual([]);
    expect(result.requiresLogout).toBe(false);
  });
});
