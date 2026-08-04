/**
 * The value types a `defaults` key can hold in our registry. `plist` covers
 * structured values (nested arrays and dictionaries) such as keyboard
 * shortcuts and text replacements.
 */
export type SettingType = 'boolean' | 'integer' | 'float' | 'string' | 'plist';

/** A structured property-list value: scalars, arrays, and dictionaries. */
export type PlistValue = boolean | number | string | PlistValue[] | { [key: string]: PlistValue };

/** A concrete value for a setting, as it appears in TOML and on the system. */
export type SettingValue = PlistValue;

/** Processes that must be restarted for a written default to take effect. */
export type RestartTarget = 'Dock' | 'Finder' | 'SystemUIServer';

/**
 * One macOS preference we know how to capture and restore.
 *
 * The registry of these definitions is the single source of truth: it drives
 * what `capture` reads, how the TOML file is annotated, and what `apply`
 * writes back.
 */
export type SettingDefinition = {
  /** TOML table this setting lives under (e.g. `keyboard`). */
  section: string;
  /** TOML key within the section (kebab-case, human-oriented). */
  key: string;
  /** One-line explanation emitted as a comment above the key in the TOML file. */
  description: string;
  /** The `defaults` domain (`NSGlobalDomain` or a bundle identifier). */
  domain: string;
  /** The raw key within the domain. */
  defaultsKey: string;
  /** How to parse and write the value. */
  type: SettingType;
  /** Extra domains that must receive the same value on apply (e.g. Bluetooth trackpad). */
  mirrorDomains?: string[];
  /** True when the key lives in the per-host domain (`defaults -currentHost`). */
  perHost?: boolean;
  /**
   * Derived settings need custom read/write logic instead of raw key access.
   * `dock-applications` reads the Dock's pinned-app tiles as a list of app
   * URLs and writes them back as minimal tiles.
   */
  special?: 'dock-applications';
  /**
   * Display name override. When absent, the label derives from the key
   * (`key-repeat-rate` → "Key Repeat Rate").
   */
  label?: string;
  /**
   * The complete set of meaningful values, when the setting is an
   * enumeration. Drives legend comments in the TOML, advisory validation in
   * doctor, and dropdowns in a future UI.
   */
  choices?: SettingChoice[];
  /** The sensible numeric range, when the setting is a bounded number. */
  range?: SettingRange;
  /** Set to `caution` when a bad value can break something important. */
  risk?: 'caution';
  /** Extra search terms a person might use to find this setting. */
  keywords?: string[];
  /** The value macOS uses when the key is unset, where reliably known. */
  macosDefault?: SettingValue;
  /** Process to `killall` after applying so the change takes effect. */
  restart?: RestartTarget;
  /** True when the change only fully applies after logging out and back in. */
  requiresLogout?: boolean;
};

/** One allowed value of an enumerated setting, with its human meaning. */
export type SettingChoice = {
  value: boolean | number | string;
  label: string;
};

/** The bounds of a numeric setting. */
export type SettingRange = {
  min: number;
  max: number;
  step?: number;
  unit?: string;
};
