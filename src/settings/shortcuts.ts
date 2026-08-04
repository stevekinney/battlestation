import type { SettingDefinition } from './definition.js';

/**
 * Structured settings: keyboard shortcuts, text replacements, and input
 * sources. These are property-list dictionaries and arrays, stored in the
 * TOML file as pretty-printed JSON.
 */
export const shortcutsSettings: SettingDefinition[] = [
  {
    section: 'shortcuts',
    key: 'keyboard-shortcuts',
    description:
      'Every system keyboard shortcut (Mission Control, Spotlight, screenshots, and so on) keyed by numeric shortcut ID, exactly as macOS stores it. Structured value — edit with care.',
    domain: 'com.apple.symbolichotkeys',
    defaultsKey: 'AppleSymbolicHotKeys',
    type: 'plist',
    risk: 'caution',
    requiresLogout: true,
  },
  {
    section: 'shortcuts',
    key: 'text-replacements',
    description:
      'Text replacements (System Settings → Keyboard → Text). Note: macOS also syncs these via iCloud, which can overwrite a restored value.',
    domain: 'NSGlobalDomain',
    defaultsKey: 'NSUserDictionaryReplacementItems',
    type: 'plist',
    requiresLogout: true,
  },
  {
    section: 'shortcuts',
    key: 'input-sources',
    description:
      'Enabled keyboard input sources. Structured value — restoring an invalid list can break keyboard input, so edit with care.',
    domain: 'com.apple.HIToolbox',
    defaultsKey: 'AppleEnabledInputSources',
    type: 'plist',
    risk: 'caution',
    requiresLogout: true,
  },
];
