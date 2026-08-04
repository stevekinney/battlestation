import chalk from 'chalk';

const heading = (text: string): string => chalk.bold(text);
const command = (text: string): string => chalk.cyan(text);

/** The CLI's global help text. */
export const help = `${chalk.bold('battlestation')} — capture and restore macOS system preferences

${heading('Usage:')}
  battlestation ${command('capture')} [--file <path>]         Snapshot current settings to TOML
  battlestation ${command('diff')}    [--file <path>]         Show how the system differs from the TOML
  battlestation ${command('apply')}   [--file <path>]         Make the system match the TOML
  battlestation ${command('doctor')}  [--fix]                 Check the TOML for problems
  battlestation ${command('list')}    [--json]                List every known setting
  battlestation ${command('get')}     <section.key> [--json]  Show one setting's values
  battlestation ${command('set')}     <section.key> <value>   Set a value in the TOML file
  battlestation ${command('unset')}   <section.key>           Remove a value from the TOML file
  battlestation ${command('mcp')}                             Run as a STDIO MCP server

Apply is declarative: settings in the TOML are written, and settings absent
from the TOML (commented out) are deleted so macOS falls back to its default.

${heading('Options:')}
  --file <path>   TOML file to read or write (default: battlestation.toml)
  --dry-run       For apply: show what would change without changing anything
  --yes           For apply: skip the confirmation prompt (required with --json)
  --fix           For doctor: remove unknown entries and rewrite canonically
  --json          For diff, apply, list, and get: print machine-readable JSON
  --help          Show this message

Run ${command('battlestation <command> --help')} for details on any command.
`;

/** Detailed help for each command, shown by `battlestation <command> --help`. */
export const commandHelp: Record<string, string> = {
  capture: `${heading('battlestation capture')} — snapshot current macOS settings to TOML

${heading('Usage:')} battlestation capture [--file <path>]

Reads every setting battlestation knows about from the live system and writes
an annotated TOML file. Every setting carries a comment explaining what it does
and, where known, its legal values; settings not set on this machine appear as
commented-out keys so the file documents everything it can manage.

${heading('Options:')}
  --file <path>   Where to write the TOML (default: battlestation.toml).
                  Parent directories are created as needed.

${heading('Example:')}
  battlestation capture --file ~/settings/macbook.toml
`,
  diff: `${heading('battlestation diff')} — show how the live system differs from the TOML

${heading('Usage:')} battlestation diff [--file <path>] [--json]

Compares every registered setting against the file. Settings present in the
TOML that differ from the system show as writes; settings absent from the TOML
but set on the system show as deletions (applying would restore the macOS
default). Exits 0 whether or not there is drift.

${heading('Options:')}
  --file <path>   TOML file to compare against (default: battlestation.toml)
  --json          Print changes as a JSON array (address, label, current,
                  target, restart, requiresLogout) for scripts and UIs

${heading('Example:')}
  battlestation diff --json | jq '.[].address'
`,
  apply: `${heading('battlestation apply')} — make the system match the TOML

${heading('Usage:')} battlestation apply [--file <path>] [--dry-run] [--yes] [--json]

Apply is declarative: settings in the TOML are written with \`defaults write\`,
and registry settings absent from the TOML (commented out) that are set on the
system are deleted, restoring the macOS default. Before writing anything, a
full snapshot of the pre-apply state is saved next to the file
(<name>.undo.toml) — revert with \`battlestation apply --file <name>.undo.toml\`.
Affected processes (Dock, Finder, SystemUIServer) restart once at the end.

${heading('Options:')}
  --file <path>   TOML file to apply (default: battlestation.toml)
  --dry-run       Show the change list and stop; nothing is written
  --yes           Skip the confirmation prompt
  --json          Print the outcome as JSON; non-interactive, so requires
                  --yes (or --dry-run)

${heading('Examples:')}
  battlestation apply
  battlestation apply --json --yes
`,
  doctor: `${heading('battlestation doctor')} — check the TOML file for problems

${heading('Usage:')} battlestation doctor [--file <path>] [--fix]

Validates the file and reports every problem at once. Blocking errors (TOML
syntax, unknown sections or keys, wrong value types) exit 1; advisory
[warning]s (values outside a setting's known choices or range) exit 0, since
macOS often accepts values System Settings does not offer.

${heading('Options:')}
  --file <path>   TOML file to check (default: battlestation.toml)
  --fix           Remove unknown entries and rewrite the file canonically.
                  Refuses while [manual] errors (syntax, wrong types) remain.

${heading('Example:')}
  battlestation doctor --fix
`,
  list: `${heading('battlestation list')} — list every known setting

${heading('Usage:')} battlestation list [--file <path>] [--json]

Shows each registered setting with its value in the TOML file and on the live
system. A missing file simply shows every file value as unset.

${heading('Options:')}
  --file <path>   TOML file to read (default: battlestation.toml)
  --json          Full machine-readable reports: address, label, type,
                  description, file/system values, choices, range, risk,
                  restart, and logout requirements

${heading('Example:')}
  battlestation list --json | jq '.[] | select(.risk == "caution")'
`,
  get: `${heading('battlestation get')} — show one setting's values

${heading('Usage:')} battlestation get <section.key> [--file <path>] [--json]

Shows a single setting's description, file value, and live system value.

${heading('Options:')}
  --file <path>   TOML file to read (default: battlestation.toml)
  --json          Machine-readable report including choices/range metadata

${heading('Example:')}
  battlestation get dock.icon-size
`,
  set: `${heading('battlestation set')} — set a value in the TOML file

${heading('Usage:')} battlestation set <section.key> <value> [--file <path>]

Validates the value against the setting's type and writes it into the file,
re-rendering the file canonically (comments and header preserved). The system
is not touched — run \`battlestation apply\` afterwards. Booleans take
true/false; structured (plist) settings take a JSON literal.

${heading('Options:')}
  --file <path>   TOML file to edit (default: battlestation.toml)

${heading('Examples:')}
  battlestation set dock.icon-size 48
  battlestation set dock.auto-hide true
`,
  unset: `${heading('battlestation unset')} — remove a value from the TOML file

${heading('Usage:')} battlestation unset <section.key> [--file <path>]

Removes the setting from the file (back to a commented-out key). Because apply
is declarative, the next \`battlestation apply\` deletes the key from the
system, restoring the macOS default.

${heading('Options:')}
  --file <path>   TOML file to edit (default: battlestation.toml)

${heading('Example:')}
  battlestation unset dock.icon-size
`,
  mcp: `${heading('battlestation mcp')} — run as a STDIO MCP server

${heading('Usage:')} battlestation mcp

Speaks the Model Context Protocol over stdin/stdout so MCP clients (Claude
Code, Claude Desktop, and others) can drive battlestation as a set of tools:
capture, diff, apply, doctor, list_settings, get_setting, set_setting, and
unset_setting. Apply runs without a confirmation prompt — the MCP client's
tool-approval flow is the confirmation. Diagnostics go to stderr; stdout is
reserved for the protocol.

${heading('Example Claude Code registration:')}
  claude mcp add battlestation -- battlestation mcp
`,
};
