import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { environmentalist } from '@lostgradient/environmentalist';
import { z } from 'zod';

/** The manifest path used when nothing else supplies one. */
export function defaultManifestPath(home: string = homedir()): string {
  return join(home, '.battlestation.toml');
}

/**
 * Expand a leading `~` to the home directory and make the path absolute.
 * Configuration can arrive from a shell profile or a config file, where
 * `~/.battlestation.toml` is the natural thing to write, but Node's `fs`
 * treats `~` as an ordinary directory name.
 */
export function expandPath(value: string, home: string = homedir(), cwd = process.cwd()): string {
  if (value === '~') return home;

  const expanded = value.startsWith('~/') ? join(home, value.slice(2)) : value;

  return isAbsolute(expanded) ? expanded : join(cwd, expanded);
}

/**
 * The configuration schema. These are the settings that describe *how
 * battlestation runs* — which manifest to operate on, how often to check for
 * drift. The manifest's own contents are data, not configuration, and live in
 * the TOML file this points at.
 *
 * Per-invocation switches (`--json`, `--yes`, `--dry-run`) are deliberately
 * absent: they modify a single action rather than configuring the tool, and a
 * persisted `yes = true` would be a footgun rather than a convenience.
 */
export function createConfigurationSchema() {
  return z.object({
    configuration: z.string().default(defaultManifestPath()).meta({
      description: 'Path to the TOML settings manifest.',
      example: '~/.battlestation.toml',
    }),
    interval: z
      .enum(['hourly', 'daily', 'weekly'])
      .default('weekly')
      .meta({ description: 'How often the scheduled drift check runs.' }),
  });
}

/**
 * The configuration schema, for consumers and documentation. Resolution uses
 * its own instance from {@link createConfigurationSchema} because resolving
 * freezes the schema it is handed, which breaks Zod's lazy method binding.
 * See https://github.com/stevekinney/environmentalist/issues/5
 */
export const configurationSchema = createConfigurationSchema();

/** Configuration after resolution, with paths expanded. */
export type ResolvedConfiguration = {
  file: string;
  interval: 'hourly' | 'daily' | 'weekly';
};

/** Inputs the resolver reads, injectable so tests stay hermetic. */
export type ResolveOptions = {
  env?: Record<string, string>;
  cwd?: string;
  home?: string;
};

/**
 * Resolve configuration from every source below the command line: the
 * `BATTLESTATION_*` environment variables, `.env` files, a
 * `battlestation.config.*` in the project, `~/.battlestation`,
 * `~/.config/battlestation/`, and finally the schema defaults.
 *
 * Command-line flags are deliberately excluded here and handled by the CLI's
 * own strict argument parser, which owns the exact flag names and rejects
 * typos. Flags still win — the CLI layers them on top of this result — so the
 * usual most-explicit-wins order holds.
 */
export async function resolveConfiguration(
  options: ResolveOptions = {},
): Promise<ResolvedConfiguration> {
  const home = options.home ?? homedir();
  const result = await environmentalist.safe({
    name: 'battlestation',
    schema: createConfigurationSchema(),
    envPrefix: 'BATTLESTATION',
    exclude: ['flags', 'search-params'],
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });

  if (!result.success) throw result.error;

  return {
    file: expandPath(result.data.configuration, home, options.cwd),
    interval: result.data.interval,
  };
}
