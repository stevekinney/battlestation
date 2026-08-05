import { describe, expect, it } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  configurationSchema,
  defaultManifestPath,
  expandPath,
  resolveConfiguration,
} from './configuration.js';

/**
 * An empty directory keeps the project-config and package.json sources from
 * finding anything, so these assertions describe the resolver rather than
 * whatever happens to sit in the repository.
 */
async function emptyCwd(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'battlestation-config-'));
}

describe('defaultManifestPath', () => {
  it('is a dotfile in the home directory, so it is findable without remembering a path', () => {
    expect(defaultManifestPath('/Users/test')).toBe('/Users/test/.battlestation.toml');
  });
});

describe('expandPath', () => {
  it('expands a leading tilde', () => {
    expect(expandPath('~/settings.toml', '/Users/test')).toBe('/Users/test/settings.toml');
    expect(expandPath('~', '/Users/test')).toBe('/Users/test');
  });

  it('leaves absolute paths alone and resolves relative ones against the working directory', () => {
    expect(expandPath('/etc/settings.toml', '/Users/test', '/work')).toBe('/etc/settings.toml');
    expect(expandPath('settings.toml', '/Users/test', '/work')).toBe('/work/settings.toml');
  });

  it('does not treat a tilde inside a path as a home reference', () => {
    expect(expandPath('/opt/~backup/x.toml', '/Users/test')).toBe('/opt/~backup/x.toml');
  });
});

describe('resolveConfiguration', () => {
  it('defaults to the home dotfile with a weekly interval', async () => {
    const resolved = await resolveConfiguration({
      env: {},
      cwd: await emptyCwd(),
      home: '/Users/t',
    });

    expect(resolved.file).toBe(defaultManifestPath());
    expect(resolved.interval).toBe('weekly');
  });

  it('honors BATTLESTATION_CONFIGURATION and expands its tilde', async () => {
    const resolved = await resolveConfiguration({
      env: { BATTLESTATION_CONFIGURATION: '~/dotfiles/mac.toml' },
      cwd: await emptyCwd(),
      home: '/Users/test',
    });

    expect(resolved.file).toBe('/Users/test/dotfiles/mac.toml');
  });

  it('honors BATTLESTATION_INTERVAL', async () => {
    const resolved = await resolveConfiguration({
      env: { BATTLESTATION_INTERVAL: 'daily' },
      cwd: await emptyCwd(),
    });

    expect(resolved.interval).toBe('daily');
  });

  it('ignores a bare CONFIGURATION variable, which is not ours to read', async () => {
    const resolved = await resolveConfiguration({
      env: { CONFIGURATION: '/not/ours.toml' },
      cwd: await emptyCwd(),
    });

    expect(resolved.file).toBe(defaultManifestPath());
  });

  it('fails loudly on an invalid interval rather than silently picking one', async () => {
    expect(
      resolveConfiguration({
        env: { BATTLESTATION_INTERVAL: 'fortnightly' },
        cwd: await emptyCwd(),
      }),
    ).rejects.toThrow();
  });
});

describe('configurationSchema', () => {
  it('describes every key, so errors and docs stay generated rather than hand-written', () => {
    for (const [key, field] of Object.entries(configurationSchema.shape)) {
      expect(field.meta()?.description, `${key} is missing a description`).toBeTruthy();
    }
  });
});
