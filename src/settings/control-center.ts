import type { SettingDefinition } from './definition.js';

const placement = (module: string, key: string): SettingDefinition => ({
  section: 'control-center',
  key,
  description: `Placement code for the ${module} Control Center module, stored per host. Managed by Control Center settings; captured as-is.`,
  domain: 'com.apple.controlcenter',
  defaultsKey: module,
  type: 'integer',
  perHost: true,
});

/** Control Center module placement (per-host) and the screen saver. */
export const controlCenterSettings: SettingDefinition[] = [
  placement('WiFi', 'wifi'),
  placement('Bluetooth', 'bluetooth'),
  placement('AirDrop', 'airdrop'),
  placement('FocusModes', 'focus-modes'),
  placement('ScreenMirroring', 'screen-mirroring'),
  placement('Display', 'display'),
  placement('Sound', 'sound'),
  placement('NowPlaying', 'now-playing'),
  placement('Battery', 'battery'),
  placement('Siri', 'siri'),
  placement('Weather', 'weather'),
  placement('VoiceControl', 'voice-control'),
  placement('MusicRecognition', 'music-recognition'),
  placement('Hearing', 'hearing'),
  placement('KeyboardBrightness', 'keyboard-brightness'),
  {
    section: 'control-center',
    key: 'menu-bar-auto-hide-option',
    description:
      'Menu bar auto-hide option code as stored by Control Center settings; captured as-is.',
    domain: 'com.apple.controlcenter',
    defaultsKey: 'AutoHideMenuBarOption',
    type: 'integer',
  },
  {
    section: 'screen-saver',
    key: 'idle-time',
    description:
      'Seconds of inactivity before the screen saver starts (0 = never), stored per host.',
    domain: 'com.apple.screensaver',
    defaultsKey: 'idleTime',
    type: 'integer',
    perHost: true,
  },
];
