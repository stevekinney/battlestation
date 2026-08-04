import type { CommandRunner } from './defaults.js';
import { deleteSetting, readSetting, writeSetting } from './defaults.js';
import { plistEquals } from './plist.js';
import type { RestartTarget, SettingDefinition, SettingValue } from './settings/definition.js';
import { registry } from './settings/registry.js';
import type { DesiredSetting } from './toml.js';

/**
 * One setting whose live system value differs from the TOML file. A `target`
 * of undefined means the TOML omits the setting, so applying deletes the key
 * and macOS falls back to its built-in default.
 */
export type PendingChange = {
  definition: SettingDefinition;
  current: SettingValue | undefined;
  target: SettingValue | undefined;
};

/**
 * Compare the TOML's view of the system against the live one, covering every
 * registered setting: settings in the TOML that differ become writes, and
 * settings absent from the TOML but set on the system become deletions.
 */
export async function diffSettings(
  desired: DesiredSetting[],
  run: CommandRunner,
): Promise<PendingChange[]> {
  const targets = new Map(desired.map((entry) => [entry.definition, entry.value]));
  const changes: PendingChange[] = [];

  for (const definition of registry) {
    const current = await readSetting(definition, run);
    const target = targets.get(definition);

    if (!plistEquals(current, target)) changes.push({ definition, current, target });
  }

  return changes;
}

/** The outcome of applying a set of pending changes. */
export type ApplyResult = {
  restarted: RestartTarget[];
  requiresLogout: boolean;
};

/**
 * Write (or delete) every pending change on the system, then restart the
 * processes (Dock, Finder, SystemUIServer) that must relaunch to pick the
 * changes up.
 */
export async function applyChanges(
  changes: PendingChange[],
  run: CommandRunner,
  onApplied?: (change: PendingChange) => void,
): Promise<ApplyResult> {
  const restartTargets = new Set<RestartTarget>();
  let requiresLogout = false;

  for (const change of changes) {
    await (change.target === undefined
      ? deleteSetting(change.definition, run)
      : writeSetting(change.definition, change.target, run));
    onApplied?.(change);

    if (change.definition.restart) restartTargets.add(change.definition.restart);
    if (change.definition.requiresLogout) requiresLogout = true;
  }

  for (const target of restartTargets) {
    await run('killall', [target]);
  }

  return { restarted: [...restartTargets], requiresLogout };
}
