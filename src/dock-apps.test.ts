import { describe, expect, it } from 'bun:test';

import type { CommandRunner } from './defaults.js';
import { readSetting, writeSetting } from './defaults.js';
import { readDockApplications, writeDockApplications } from './dock-apps.js';
import { findDefinition } from './settings/registry.js';

const pinned = findDefinition('dock', 'pinned-applications')!;

/** A fake Dock with two app tiles and a spacer tile at index 1. */
const dockRun: CommandRunner = async (_, args) => {
  const keypath = args[1];
  if (keypath === 'persistent-apps') return { stdout: '3\n', exitCode: 0 };
  if (keypath === 'persistent-apps.0.tile-data.file-data._CFURLString') {
    return { stdout: 'file:///Applications/Safari.app/\n', exitCode: 0 };
  }
  if (keypath === 'persistent-apps.2.tile-data.file-data._CFURLString') {
    return { stdout: 'file:///Applications/Notes.app/\n', exitCode: 0 };
  }

  return { stdout: '', exitCode: 1 };
};

const emptyFailingRun: CommandRunner = async () => ({ stdout: '', exitCode: 1 });
const emptySucceedingRun: CommandRunner = async () => ({ stdout: '', exitCode: 0 });

describe('readDockApplications', () => {
  it('derives an ordered URL list, skipping tiles without a file URL', async () => {
    expect(await readDockApplications(dockRun)).toEqual([
      'file:///Applications/Safari.app/',
      'file:///Applications/Notes.app/',
    ]);
  });

  it('returns undefined when persistent-apps is missing', async () => {
    expect(await readDockApplications(emptyFailingRun)).toBeUndefined();
  });

  it('is what readSetting delegates to for the pinned-applications setting', async () => {
    expect(await readSetting(pinned, dockRun)).toEqual([
      'file:///Applications/Safari.app/',
      'file:///Applications/Notes.app/',
    ]);
  });
});

describe('writeDockApplications', () => {
  it('writes minimal file tiles from app URLs', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = async (command, args) => {
      calls.push([command, ...args]);
      return { stdout: '', exitCode: 0 };
    };

    await writeSetting(pinned, ['file:///Applications/Safari.app/'], run);

    expect(calls).toEqual([
      [
        'defaults',
        'write',
        'com.apple.dock',
        'persistent-apps',
        '<array><dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>file:///Applications/Safari.app/</string><key>_CFURLStringType</key><integer>15</integer></dict></dict><key>tile-type</key><string>file-tile</string></dict></array>',
      ],
    ]);
  });

  it('rejects values that are not arrays of URL strings', async () => {
    expect(writeDockApplications({ nope: true }, emptySucceedingRun)).rejects.toThrow(
      'dock.pinned-applications must be an array of app URL strings',
    );
    expect(writeDockApplications([1], emptySucceedingRun)).rejects.toThrow(
      'dock.pinned-applications must be an array of app URL strings',
    );
  });

  it('throws when the defaults write fails', async () => {
    expect(
      writeDockApplications(['file:///Applications/Safari.app/'], emptyFailingRun),
    ).rejects.toThrow('Failed to write com.apple.dock persistent-apps');
  });
});
