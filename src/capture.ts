import type { CommandRunner } from './defaults.js';
import { readSetting } from './defaults.js';
import { registry } from './settings/registry.js';
import type { CapturedSetting } from './toml.js';
import { renderToml } from './toml.js';

/** Read every registered setting from the system. */
export async function captureSettings(run: CommandRunner): Promise<CapturedSetting[]> {
  const captured: CapturedSetting[] = [];

  for (const definition of registry) {
    captured.push({ definition, value: await readSetting(definition, run) });
  }

  return captured;
}

/** The comment block at the top of a captured TOML file. */
export async function buildHeader(run: CommandRunner, capturedAt: Date): Promise<string[]> {
  const version = await run('sw_vers', ['-productVersion']);
  const macos = version.exitCode === 0 ? ` on macOS ${version.stdout.trim()}` : '';

  return [
    'battlestation — macOS system preferences snapshot',
    `Captured ${capturedAt.toISOString()}${macos}.`,
    'Edit values freely, then run `battlestation apply` to write them back.',
    'Commented-out keys were not set at capture time; macOS used its built-in default.',
  ];
}

/** Capture the current system configuration as an annotated TOML document. */
export async function captureToml(run: CommandRunner, capturedAt: Date): Promise<string> {
  const [captured, header] = await Promise.all([
    captureSettings(run),
    buildHeader(run, capturedAt),
  ]);

  return renderToml(captured, header);
}
