import { describe, expect, it } from 'bun:test';

import { makeEnvironment } from '../test/cli-helpers.js';
import {
  agentLabel,
  agentLogPath,
  agentPath,
  buildAgentPlist,
  buildDriftCommand,
  intervals,
  resolveInvocation,
  scheduleCommand,
} from './schedule.js';

const baseOptions = {
  file: 'battlestation.toml',
  dryRun: false,
  yes: true,
  fix: false,
  json: false,
  exitCode: false,
  interval: 'weekly',
  uninstall: false,
  arguments: [] as string[],
};

describe('paths', () => {
  it('places the agent and its log under the given home directory', () => {
    expect(agentPath('/Users/test')).toBe(`/Users/test/Library/LaunchAgents/${agentLabel}.plist`);
    expect(agentLogPath('/Users/test')).toBe(
      '/Users/test/Library/Logs/battlestation-drift-check.log',
    );
  });
});

describe('resolveInvocation', () => {
  it('uses the runtime plus the script when running from a script', () => {
    expect(resolveInvocation('/opt/bin/node', '/usr/local/lib/index.js')).toBe(
      "'/opt/bin/node' '/usr/local/lib/index.js'",
    );
  });

  it('uses the executable alone for compiled binaries and virtual paths', () => {
    expect(resolveInvocation('/usr/local/bin/battlestation', undefined)).toBe(
      "'/usr/local/bin/battlestation'",
    );
    expect(resolveInvocation('/bin/bs', '/bin/bs')).toBe("'/bin/bs'");
    expect(resolveInvocation('/bin/bs', '/$bunfs/root/bs')).toBe("'/bin/bs'");
  });

  it('quotes paths containing spaces and single quotes', () => {
    expect(resolveInvocation("/Apps/My Tool/it's", undefined)).toBe(
      String.raw`'/Apps/My Tool/it'\''s'`,
    );
  });
});

describe('buildDriftCommand', () => {
  it('checks for drift and notifies only on failure, never applying', () => {
    const command = buildDriftCommand("'/bin/bs'", '/Users/test/settings.toml');

    expect(command).toContain("diff --exit-code --file '/Users/test/settings.toml'");
    expect(command).toContain('|| /usr/bin/osascript -e');
    expect(command).toContain('display notification');
    expect(command).not.toContain('apply');
  });
});

describe('buildAgentPlist', () => {
  it('renders a loadable launchd plist that does not run at load', () => {
    const plist = buildAgentPlist('echo hi', intervals['weekly']!, '/Users/test');

    expect(plist).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain('<!DOCTYPE plist PUBLIC');
    expect(plist).toContain(`<key>Label</key><string>${agentLabel}</string>`);
    expect(plist).toContain('<string>/bin/sh</string><string>-c</string><string>echo hi</string>');
    expect(plist).toContain('<key>StartInterval</key><integer>604800</integer>');
    expect(plist).toContain('<key>RunAtLoad</key><false/>');
    expect(plist).toContain('battlestation-drift-check.log');
  });

  it('escapes XML-significant characters in the command', () => {
    expect(buildAgentPlist('a && b > c', 3600)).toContain('a &amp;&amp; b &gt; c');
  });
});

describe('scheduleCommand', () => {
  it('writes the agent, replaces any previous one, and loads it', async () => {
    const files = new Map<string, string>();
    const { environment, logs, commands } = makeEnvironment(files);

    expect(await scheduleCommand({ ...baseOptions, interval: 'daily' }, environment)).toBe(0);

    const written = files.get(agentPath());
    expect(written).toContain('<key>StartInterval</key><integer>86400</integer>');
    expect(commands.filter((call) => call[1] === 'bootout')).toHaveLength(1);
    expect(commands.some((call) => call[1] === 'bootstrap')).toBe(true);
    expect(logs[0]).toBe('Scheduled a daily drift check.');
    expect(logs.join('\n')).toContain('never changes settings');
  });

  it('rejects an unknown interval without writing anything', async () => {
    const files = new Map<string, string>();
    const { environment, logs } = makeEnvironment(files);

    expect(await scheduleCommand({ ...baseOptions, interval: 'fortnightly' }, environment)).toBe(1);
    expect(logs[0]).toContain('Unknown interval "fortnightly"');
    expect(files.size).toBe(0);
  });

  it('reports a launchctl failure with a manual fallback', async () => {
    const files = new Map<string, string>();
    const { environment, logs } = makeEnvironment(files);
    const failing = {
      ...environment,
      run: async (command: string, args: string[]) =>
        args[0] === 'bootstrap' ? { stdout: '', exitCode: 1 } : environment.run(command, args),
    };

    expect(await scheduleCommand(baseOptions, failing)).toBe(1);
    expect(logs.at(-2)).toContain('launchctl could not load it');
    expect(logs.at(-1)).toContain('launchctl bootstrap');
  });

  it('--uninstall unloads and removes the agent', async () => {
    const files = new Map([[agentPath(), 'existing']]);
    const { environment, logs, commands } = makeEnvironment(files);

    expect(await scheduleCommand({ ...baseOptions, uninstall: true }, environment)).toBe(0);
    expect(files.has(agentPath())).toBe(false);
    expect(commands.some((call) => call[1] === 'bootout')).toBe(true);
    expect(logs[0]).toBe('Removed the scheduled drift check.');
  });
});
