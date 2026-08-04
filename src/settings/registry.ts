import type { SettingDefinition } from './definition.js';
import { controlCenterSettings } from './control-center.js';
import { dockSettings } from './dock.js';
import { finderSettings } from './finder.js';
import { inputSettings } from './input.js';
import { interfaceSettings } from './interface.js';
import { keyboardSettings } from './keyboard.js';
import { shortcutsSettings } from './shortcuts.js';
import { systemSettings } from './system.js';

/**
 * Every setting battlestation knows about, in the order it appears in the
 * TOML file.
 */
export const registry: SettingDefinition[] = [
  ...interfaceSettings.filter((setting) => setting.section === 'appearance'),
  ...keyboardSettings,
  ...shortcutsSettings,
  ...inputSettings,
  ...dockSettings,
  ...finderSettings,
  ...interfaceSettings.filter((setting) => setting.section !== 'appearance'),
  ...controlCenterSettings,
  ...systemSettings,
];

/** Section names in the order they appear in the TOML file. */
export const sectionOrder: string[] = [...new Set(registry.map((setting) => setting.section))];

/** Look up a definition by its TOML address, or undefined if unknown. */
export function findDefinition(section: string, key: string): SettingDefinition | undefined {
  return registry.find((setting) => setting.section === section && setting.key === key);
}
