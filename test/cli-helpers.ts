import chalk from 'chalk';

import type { CliEnvironment } from '../src/cli.js';
import type { CommandRunner } from '../src/defaults.js';

// Pin chalk to the no-color path so assertions on exact output hold whether
// or not the test runner is attached to a TTY.
chalk.level = 0;

/** A fake system where Dock auto-hide is on and everything else is unset. */
export const fakeRun: CommandRunner = async (command, args) => {
  if (command === 'sw_vers') return { stdout: '26.5.2\n', exitCode: 0 };
  if (command === 'killall') return { stdout: '', exitCode: 0 };
  if (command === 'launchctl') return { stdout: '', exitCode: 0 };
  if (args[0] === 'write' || args[0] === 'delete') return { stdout: '', exitCode: 0 };
  if (args[1] === 'com.apple.dock' && args[2] === 'autohide') {
    return { stdout: '1\n', exitCode: 0 };
  }

  return { stdout: '', exitCode: 1 };
};

/** A CLI environment over an in-memory filesystem, recording all activity. */
export function makeEnvironment(
  files: Map<string, string>,
  confirmAnswer = true,
): { environment: CliEnvironment; logs: string[]; confirmations: string[]; commands: string[][] } {
  const logs: string[] = [];
  const confirmations: string[] = [];
  const commands: string[][] = [];
  const environment: CliEnvironment = {
    run: async (command, args) => {
      commands.push([command, ...args]);
      return fakeRun(command, args);
    },
    readTextFile: async (path) => {
      const contents = files.get(path);
      if (contents === undefined) throw new Error(`No such file: ${path}`);
      return contents;
    },
    writeTextFile: async (path, contents) => {
      files.set(path, contents);
    },
    removeTextFile: async (path) => {
      files.delete(path);
    },
    log: (message) => logs.push(message),
    confirm: async (question) => {
      confirmations.push(question);
      return confirmAnswer;
    },
    now: () => new Date('2026-08-04T00:00:00Z'),
  };

  return { environment, logs, confirmations, commands };
}
