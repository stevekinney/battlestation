import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type { CliEnvironment, CommandOptions } from './cli.js';
import { applyCommand, captureCommand, diffCommand } from './commands.js';
import {
  doctorCommand,
  getCommand,
  listCommand,
  setCommand,
  unsetCommand,
} from './file-commands.js';

import packageDefinition from '../package.json' with { type: 'json' };

const fileSchema = z
  .string()
  .optional()
  .describe(
    'Path to the TOML settings file (default: battlestation.toml in the working directory)',
  );

const addressSchema = z
  .string()
  .describe('The setting address as section.key, e.g. "dock.icon-size"');

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

type CommandHandler = (options: CommandOptions, environment: CliEnvironment) => Promise<number>;

/**
 * Run one CLI command with a capturing environment and package its output as
 * an MCP tool result. Nonzero exit codes become isError results.
 */
async function runCommandAsTool(
  handler: CommandHandler,
  file: string | undefined,
  options: Partial<CommandOptions>,
  environment: CliEnvironment,
): Promise<ToolResult> {
  const logs: string[] = [];
  // Every tool runs with yes: true, so no command ever prompts — the MCP
  // client's tool-approval flow is the confirmation.
  const capturing: CliEnvironment = {
    ...environment,
    log: (message) => logs.push(message),
  };

  const merged: CommandOptions = {
    file: 'battlestation.toml',
    dryRun: false,
    yes: true,
    fix: false,
    json: false,
    // Tools report drift in their JSON payload, so an MCP call never fails
    // merely because the system differs from the file.
    exitCode: false,
    interval: 'weekly',
    uninstall: false,
    arguments: [],
    ...options,
  };
  if (file !== undefined) merged.file = file;

  const exitCode = await handler(merged, capturing);

  if (exitCode === 0) return { content: [{ type: 'text', text: logs.join('\n') }] };

  return { content: [{ type: 'text', text: logs.join('\n') }], isError: true };
}

/**
 * Build the battlestation MCP server: every CLI capability exposed as a tool,
 * backed by the same command implementations the CLI uses.
 */
export function createMcpServer(environment: CliEnvironment): McpServer {
  const server = new McpServer({
    name: 'battlestation',
    version: packageDefinition.version,
  });

  server.registerTool(
    'capture',
    {
      description:
        'Snapshot the current macOS system preferences to an annotated TOML file. Overwrites the file with the live system state.',
      inputSchema: { file: fileSchema },
    },
    ({ file }) => runCommandAsTool(captureCommand, file, {}, environment),
  );

  server.registerTool(
    'diff',
    {
      description:
        'Compare the TOML file against the live system. Returns a JSON array of pending changes (writes and deletions); an empty array means the system matches the file.',
      inputSchema: { file: fileSchema },
    },
    ({ file }) => runCommandAsTool(diffCommand, file, { json: true }, environment),
  );

  server.registerTool(
    'apply',
    {
      description:
        'Make the macOS system match the TOML file: writes drifted settings, deletes settings absent from the file (restoring macOS defaults), saves an undo snapshot first, and restarts affected processes (Dock/Finder/SystemUIServer). Returns JSON including the undo file path. Set dryRun to preview without changing anything.',
      inputSchema: {
        file: fileSchema,
        dryRun: z.boolean().optional().describe('Preview the changes without applying them'),
      },
    },
    ({ file, dryRun }) =>
      runCommandAsTool(applyCommand, file, { json: true, dryRun: dryRun ?? false }, environment),
  );

  server.registerTool(
    'doctor',
    {
      description:
        'Check the TOML file for problems: syntax errors, unknown settings, wrong types (blocking), and out-of-domain values (advisory warnings). Set fix to remove unknown entries and rewrite the file canonically.',
      inputSchema: {
        file: fileSchema,
        fix: z.boolean().optional().describe('Remove unknown entries and rewrite canonically'),
      },
    },
    ({ file, fix }) => runCommandAsTool(doctorCommand, file, { fix: fix ?? false }, environment),
  );

  server.registerTool(
    'list_settings',
    {
      description:
        'List every setting battlestation manages as JSON: address, label, type, description, file and system values, allowed choices, numeric range, risk flags, and restart/logout requirements.',
      inputSchema: { file: fileSchema },
    },
    ({ file }) => runCommandAsTool(listCommand, file, { json: true }, environment),
  );

  server.registerTool(
    'get_setting',
    {
      description:
        'Show one setting as JSON: its description, metadata, value in the TOML file, and current value on the live system.',
      inputSchema: { address: addressSchema, file: fileSchema },
    },
    ({ address, file }) =>
      runCommandAsTool(getCommand, file, { json: true, arguments: [address] }, environment),
  );

  server.registerTool(
    'set_setting',
    {
      description:
        'Set a value in the TOML file (the system is untouched until apply runs). Booleans take "true"/"false"; structured (plist) settings take a JSON literal. The file is re-rendered canonically with comments preserved.',
      inputSchema: {
        address: addressSchema,
        value: z
          .string()
          .describe(
            'The value literal, e.g. "48", "true", "left", or JSON for structured settings',
          ),
        file: fileSchema,
      },
    },
    ({ address, value, file }) =>
      runCommandAsTool(setCommand, file, { arguments: [address, value] }, environment),
  );

  server.registerTool(
    'unset_setting',
    {
      description:
        'Remove a setting from the TOML file (back to a commented-out key). The next apply deletes it from the system, restoring the macOS default.',
      inputSchema: { address: addressSchema, file: fileSchema },
    },
    ({ address, file }) =>
      runCommandAsTool(unsetCommand, file, { arguments: [address] }, environment),
  );

  return server;
}

let activeServer: McpServer | undefined;

/** Write a diagnostic line to stderr — stdout belongs to the MCP protocol. */
export function logToStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * The `battlestation mcp` command: serve the MCP tools over stdio. Stdout
 * belongs to the protocol, so diagnostics go to stderr.
 */
export async function mcpCommand(
  _options: CommandOptions,
  environment: CliEnvironment,
): Promise<number> {
  activeServer = createMcpServer({ ...environment, log: logToStderr });
  await activeServer.connect(new StdioServerTransport());
  process.stderr.write('battlestation MCP server running on stdio\n');

  return 0;
}

/** Shut down the running MCP server (used by tests and shutdown paths). */
export async function closeMcpServer(): Promise<void> {
  await activeServer?.close();
  activeServer = undefined;
}
