import type { CommandRunner } from './defaults.js';
import { plistPath, toPlistXml } from './plist.js';
import type { PlistValue } from './settings/definition.js';

const dockPlist = (): string => plistPath('com.apple.dock');

/**
 * Read the Dock's pinned applications as an ordered list of app URLs.
 *
 * The raw `persistent-apps` array holds binary bookmark blobs that cannot be
 * captured as JSON, so this derives the part that matters — which apps, in
 * which order. Tiles without a file URL (spacers, folders) are skipped.
 * Returns undefined when the key is missing entirely.
 */
export async function readDockApplications(run: CommandRunner): Promise<string[] | undefined> {
  const count = await run('plutil', ['-extract', 'persistent-apps', 'raw', '-o', '-', dockPlist()]);
  if (count.exitCode !== 0) return undefined;

  const urls: string[] = [];
  for (let index = 0; index < Number.parseInt(count.stdout.trim(), 10); index += 1) {
    const url = await run('plutil', [
      '-extract',
      `persistent-apps.${index}.tile-data.file-data._CFURLString`,
      'raw',
      '-o',
      '-',
      dockPlist(),
    ]);

    if (url.exitCode === 0) urls.push(url.stdout.trim());
  }

  return urls;
}

/**
 * Replace the Dock's pinned applications with minimal tiles built from app
 * URLs — the same shape dockutil writes; the Dock fills in the rest when it
 * relaunches.
 */
export async function writeDockApplications(value: PlistValue, run: CommandRunner): Promise<void> {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new TypeError('dock.pinned-applications must be an array of app URL strings');
  }

  const tiles = value.map((url) => ({
    'tile-data': { 'file-data': { _CFURLString: url, _CFURLStringType: 15 } },
    'tile-type': 'file-tile',
  }));

  const result = await run('defaults', [
    'write',
    'com.apple.dock',
    'persistent-apps',
    toPlistXml(tiles),
  ]);

  if (result.exitCode !== 0) {
    throw new Error('Failed to write com.apple.dock persistent-apps');
  }
}
