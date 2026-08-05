import { describe, expect, it } from 'bun:test';
import { realpathSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';

import chalk from 'chalk';

import { makeEnvironment } from '../test/cli-helpers.js';
import { commandHelp } from './commands.js';
import {
  askConfirmation,
  commands as commandRegistry,
  defaultEnvironment,
  isMainModule,
  run,
} from './index.js';
import { closeMcpServer } from './mcp.js';

describe('run', () => {
  it('prints help with --help and exits 0', async () => {
    const { environment, logs } = makeEnvironment(new Map());

    expect(await run(['--help'], environment)).toBe(0);
    expect(logs[0]).toContain('battlestation — capture and restore');
  });

  it('prints help with no command and exits 1', async () => {
    const { environment, logs } = makeEnvironment(new Map());

    expect(await run([], environment)).toBe(1);
    expect(logs[0]).toContain('Usage:');
  });

  it('rejects unknown commands', async () => {
    const { environment, logs } = makeEnvironment(new Map());

    expect(await run(['destroy'], environment)).toBe(1);
    expect(logs[0]).toContain('Unknown command: destroy');
  });

  it('captures settings to the default file', async () => {
    const files = new Map<string, string>();
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['capture'], environment)).toBe(0);
    expect(logs.at(-1)).toBe('Captured system settings to battlestation.toml.');
    expect(files.get('battlestation.toml')).toContain('auto-hide = true');
  });

  it('diff reports no drift when the system matches', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = true\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['diff', '--file', 'settings.toml'], environment)).toBe(0);
    expect(logs).toEqual(['System matches the TOML file. Nothing to change.']);
  });

  it('diff lists writes and deletions without applying them', async () => {
    const files = new Map([['settings.toml', '[dock]\nicon-size = 48\n']]);
    const { environment, logs, commands } = makeEnvironment(files);

    expect(await run(['diff', '--file', 'settings.toml'], environment)).toBe(0);
    expect(logs[0]).toBe('2 setting(s) would change:');
    expect(logs[1]).toBe('  dock.auto-hide: true → (macOS default)');
    expect(logs[2]).toBe('  dock.icon-size: (not set) → 48');
    expect(commands.every((call) => call[1] !== 'write' && call[1] !== 'delete')).toBe(true);
  });

  it('apply reports when nothing needs to change', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = true\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['apply', '--file', 'settings.toml'], environment)).toBe(0);
    expect(logs).toEqual(['System already matches the TOML file. Nothing applied.']);
  });

  it('apply --dry-run previews changes without writing or prompting', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = false\n']]);
    const { environment, logs, confirmations, commands } = makeEnvironment(files);

    expect(await run(['apply', '--dry-run', '--file', 'settings.toml'], environment)).toBe(0);
    expect(logs.at(-1)).toBe('Dry run; nothing applied.');
    expect(confirmations).toEqual([]);
    expect(commands.every((call) => call[1] !== 'write' && call[1] !== 'delete')).toBe(true);
  });

  it('apply prompts for confirmation and aborts on no', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = false\n']]);
    const { environment, logs, confirmations, commands } = makeEnvironment(files, false);

    expect(await run(['apply', '--file', 'settings.toml'], environment)).toBe(1);
    expect(confirmations).toEqual(['Apply 1 change(s)? [y/N] ']);
    expect(logs.at(-1)).toBe('Aborted; nothing applied.');
    expect(commands.every((call) => call[1] !== 'write' && call[1] !== 'delete')).toBe(true);
  });

  it('apply proceeds when confirmed', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = false\n']]);
    const { environment, logs, confirmations } = makeEnvironment(files, true);

    expect(await run(['apply', '--file', 'settings.toml'], environment)).toBe(0);
    expect(confirmations).toHaveLength(1);
    expect(logs).toContain('Applied 1 change(s).');
    expect(logs).toContain('Restarted: Dock.');
  });

  it('apply --yes skips the prompt, writes drift, deletes absences, and notes logout', async () => {
    const files = new Map([['settings.toml', '[keyboard]\nkey-repeat-rate = 1\n']]);
    const { environment, logs, confirmations, commands } = makeEnvironment(files);

    expect(await run(['apply', '--yes', '--file', 'settings.toml'], environment)).toBe(0);
    expect(confirmations).toEqual([]);
    expect(logs[0]).toBe('2 setting(s) to apply:');
    expect(logs).toContain('Applied 2 change(s).');
    expect(logs).toContain('Some changes take full effect after you log out and back in.');
    expect(commands).toContainEqual(['defaults', 'delete', 'com.apple.dock', 'autohide']);
    expect(commands).toContainEqual([
      'defaults',
      'write',
      'NSGlobalDomain',
      'KeyRepeat',
      '-int',
      '1',
    ]);
  });
});

describe('color output', () => {
  it('emits ANSI colors when chalk has color support', async () => {
    const files = new Map([['settings.toml', '[dock]\nicon-size = 48\n']]);
    const { environment, logs } = makeEnvironment(files);

    chalk.level = 3;
    try {
      await run(['diff', '--file', 'settings.toml'], environment);
    } finally {
      chalk.level = 0;
    }

    expect(logs.join('\n')).toContain('[');
  });
});

async function answer(text: string): Promise<boolean> {
  const input = new PassThrough();
  const output = new PassThrough();
  input.end(`${text}\n`);

  return askConfirmation('Proceed? ', input, output);
}

describe('askConfirmation', () => {
  it('accepts y and yes in any case', async () => {
    expect(await answer('y')).toBe(true);
    expect(await answer('YES')).toBe(true);
  });

  it('treats anything else as no', async () => {
    expect(await answer('n')).toBe(false);
    expect(await answer('')).toBe(false);
  });
});

function parseJsonArray(text: string): Record<string, unknown>[] {
  return JSON.parse(text);
}

function parseJsonObject(text: string): Record<string, unknown> {
  return JSON.parse(text);
}

describe('per-command help', () => {
  it('documents every command', () => {
    expect(Object.keys(commandHelp).toSorted()).toEqual(Object.keys(commandRegistry).toSorted());
  });

  it('shows detailed help for each command with --help', async () => {
    for (const name of Object.keys(commandHelp)) {
      const { environment, logs } = makeEnvironment(new Map());

      expect(await run([name, '--help'], environment)).toBe(0);
      expect(logs[0]).toContain(`battlestation ${name}`);
      expect(logs[0]).toContain('Usage:');
    }
  });

  it('falls back to global help for unknown commands with --help', async () => {
    const { environment, logs } = makeEnvironment(new Map());

    expect(await run(['destroy', '--help'], environment)).toBe(0);
    expect(logs[0]).toContain('capture and restore macOS system preferences');
  });
});

describe('diff --exit-code', () => {
  it('exits 1 when the system has drifted', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = false\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['diff', '--exit-code', '--file', 'settings.toml'], environment)).toBe(1);
    expect(logs[0]).toContain('setting(s) would change');
  });

  it('exits 0 when the system matches', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = true\n']]);
    const { environment } = makeEnvironment(files);

    expect(await run(['diff', '--exit-code', '--file', 'settings.toml'], environment)).toBe(0);
  });

  it('still exits 0 on drift without the flag', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = false\n']]);
    const { environment } = makeEnvironment(files);

    expect(await run(['diff', '--file', 'settings.toml'], environment)).toBe(0);
  });

  it('applies to --json output too', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = false\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(
      await run(['diff', '--json', '--exit-code', '--file', 'settings.toml'], environment),
    ).toBe(1);
    expect(JSON.parse(logs[0]!)).toHaveLength(1);
  });
});

describe('schedule command', () => {
  it('is reachable from the CLI and honors --interval', async () => {
    const files = new Map<string, string>();
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['schedule', '--interval', 'hourly'], environment)).toBe(0);
    expect(logs[0]).toBe('Scheduled a hourly drift check.');
  });
});

describe('mcp command', () => {
  it('starts the stdio server and shuts down cleanly', async () => {
    const { environment } = makeEnvironment(new Map());

    expect(await run(['mcp'], environment)).toBe(0);
    await closeMcpServer();
  });
});

describe('json output and undo', () => {
  it('diff --json prints machine-readable changes', async () => {
    const files = new Map([['settings.toml', '[dock]\nicon-size = 48\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['diff', '--json', '--file', 'settings.toml'], environment)).toBe(0);

    const changes = parseJsonArray(logs[0]!);
    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({
      address: 'dock.icon-size',
      label: 'Icon Size',
      current: null,
      target: 48,
      restart: 'Dock',
    });
  });

  it('apply --json requires --yes', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = false\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['apply', '--json', '--file', 'settings.toml'], environment)).toBe(1);
    expect(logs[0]).toContain('pass --yes');
  });

  it('apply --json --dry-run previews without an undo file', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = false\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(
      await run(['apply', '--json', '--dry-run', '--file', 'settings.toml'], environment),
    ).toBe(0);
    expect(JSON.parse(logs[0]!)).toMatchObject({ applied: false });
    expect(files.has('settings.undo.toml')).toBe(false);
  });

  it('apply --json --yes applies, reports, and records the undo file', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = false\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['apply', '--json', '--yes', '--file', 'settings.toml'], environment)).toBe(0);

    const report = parseJsonObject(logs[0]!);
    expect(report).toMatchObject({
      applied: true,
      restarted: ['Dock'],
      undoFile: 'settings.undo.toml',
    });
    expect(files.get('settings.undo.toml')).toContain('auto-hide = true');
  });

  it('apply --json reports an already-converged system', async () => {
    const files = new Map([['settings.toml', '[dock]\nauto-hide = true\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['apply', '--json', '--yes', '--file', 'settings.toml'], environment)).toBe(0);
    expect(JSON.parse(logs[0]!)).toEqual({ applied: false, changes: [] });
  });

  it('apply saves an undo snapshot of the pre-apply state and says how to revert', async () => {
    const files = new Map([['config.toml', '[dock]\nauto-hide = false\n']]);
    const { environment, logs } = makeEnvironment(files);

    expect(await run(['apply', '--yes', '--file', 'config.toml'], environment)).toBe(0);
    expect(logs.join('\n')).toContain(
      'Undo snapshot saved to config.undo.toml; revert with `battlestation apply --file config.undo.toml`.',
    );
    expect(files.get('config.undo.toml')).toContain('auto-hide = true');
  });
});

describe('isMainModule', () => {
  it('matches the resolved entry script', () => {
    const url = pathToFileURL(realpathSync(process.argv[1]!)).href;

    expect(isMainModule(url, process.argv[1])).toBe(true);
    expect(isMainModule('file:///somewhere/else.js', process.argv[1])).toBe(false);
  });

  it('handles missing argv and unresolvable virtual paths', () => {
    expect(isMainModule('file:///anything.js', undefined)).toBe(false);
    expect(isMainModule(pathToFileURL('/$bunfs/root/app').href, '/$bunfs/root/app')).toBe(true);
  });
});

describe('defaultEnvironment', () => {
  it('wires real file access, command running, output, and time', async () => {
    const environment = await defaultEnvironment();
    const directory = await mkdtemp(join(tmpdir(), 'battlestation-'));
    const path = join(directory, 'nested', 'sample.txt');

    await environment.writeTextFile(path, 'contents');
    expect(await environment.readTextFile(path)).toBe('contents');
    expect(await readFile(path, 'utf8')).toBe('contents');

    const echoed = await environment.run('/bin/echo', ['ok']);
    expect(echoed.stdout.trim()).toBe('ok');

    await environment.removeTextFile(path);
    expect(await readFile(path, 'utf8').catch(() => 'gone')).toBe('gone');
    // Removing a file that is already gone must not throw.
    await environment.removeTextFile(path);

    expect(environment.now()).toBeInstanceOf(Date);
    expect(() => environment.log('')).not.toThrow();
    expect(environment.confirm).toBeInstanceOf(Function);
  });
});
