import { homedir } from 'node:os';
import { join } from 'node:path';

import chalk from 'chalk';

import type { CliEnvironment, CommandOptions } from './cli.js';
import { toPlistXml } from './plist.js';

/** The launchd label for the drift-check agent. */
export const agentLabel = 'com.stevekinney.battlestation.drift-check';

/** How often the drift check runs, in seconds. */
export const intervals: Record<string, number> = {
  hourly: 3600,
  daily: 86_400,
  weekly: 604_800,
};

/** Where the launchd agent lives for the current user. */
export function agentPath(home: string = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${agentLabel}.plist`);
}

/** Where the agent writes stderr, so a failing agent is diagnosable. */
export function agentLogPath(home: string = homedir()): string {
  return join(home, 'Library', 'Logs', 'battlestation-drift-check.log');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * The command line that invokes this same battlestation build. A compiled
 * executable is its own entry point; a script run under Node or Bun needs
 * the runtime in front of it.
 */
export function resolveInvocation(execPath: string, scriptPath: string | undefined): string {
  if (scriptPath === undefined || scriptPath === execPath || scriptPath.startsWith('/$bunfs')) {
    return shellQuote(execPath);
  }

  return `${shellQuote(execPath)} ${shellQuote(scriptPath)}`;
}

/**
 * The shell command the agent runs: check for drift, and notify only when
 * there is some. It never applies anything — a background job that changed
 * system settings without asking would be a trap, not a feature.
 */
export function buildDriftCommand(invocation: string, file: string): string {
  const notification =
    'display notification "Your macOS settings have drifted from ' +
    'battlestation.toml. Run: battlestation diff" with title "battlestation"';

  return `${invocation} diff --exit-code --file ${shellQuote(file)} >/dev/null 2>&1 || /usr/bin/osascript -e ${shellQuote(notification)}`;
}

/** Render the launchd property list for the drift-check agent. */
export function buildAgentPlist(
  command: string,
  intervalSeconds: number,
  home = homedir(),
): string {
  const agent = {
    Label: agentLabel,
    ProgramArguments: ['/bin/sh', '-c', command],
    StartInterval: intervalSeconds,
    RunAtLoad: false,
    StandardErrorPath: agentLogPath(home),
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${toPlistXml(agent)}
</plist>
`;
}

async function uninstallAgent(environment: CliEnvironment): Promise<number> {
  const path = agentPath();

  await environment.run('launchctl', ['bootout', `gui/${process.getuid?.() ?? 501}/${agentLabel}`]);
  await environment.removeTextFile(path);
  environment.log(chalk.green('Removed the scheduled drift check.'));

  return 0;
}

/**
 * Install (or remove) a launchd agent that periodically checks for drift and
 * sends a notification when the system no longer matches the TOML file.
 */
export async function scheduleCommand(
  options: CommandOptions,
  environment: CliEnvironment,
): Promise<number> {
  if (options.uninstall) return uninstallAgent(environment);

  const intervalSeconds = intervals[options.interval];
  if (intervalSeconds === undefined) {
    environment.log(
      chalk.red(
        `Unknown interval "${options.interval}". Choose one of: ${Object.keys(intervals).join(', ')}.`,
      ),
    );
    return 1;
  }

  const invocation = resolveInvocation(process.execPath, process.argv[1]);
  const command = buildDriftCommand(invocation, options.file);
  const path = agentPath();

  await environment.writeTextFile(path, buildAgentPlist(command, intervalSeconds));
  // Replace any previous agent, then load the new one.
  const domain = `gui/${process.getuid?.() ?? 501}`;
  await environment.run('launchctl', ['bootout', `${domain}/${agentLabel}`]);
  const result = await environment.run('launchctl', ['bootstrap', domain, path]);

  if (result.exitCode !== 0) {
    environment.log(chalk.red(`Wrote ${path} but launchctl could not load it.`));
    environment.log(chalk.dim(`Load it manually with: launchctl bootstrap ${domain} ${path}`));
    return 1;
  }

  environment.log(chalk.green(`Scheduled a ${options.interval} drift check.`));
  environment.log(chalk.dim(`  agent:   ${path}`));
  environment.log(chalk.dim(`  runs:    ${command}`));
  environment.log(chalk.dim(`  log:     ${agentLogPath()}`));
  environment.log(
    chalk.dim('It only notifies; it never changes settings. Remove it with `--uninstall`.'),
  );

  return 0;
}
