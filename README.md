# battlestation

Capture your macOS system preferences to a readable, auditable TOML file—and restore them on a new Mac.

`battlestation` knows about ~150 curated settings across keyboard, text substitution, trackpad, mouse, Dock, Mission Control, hot corners, Finder, screenshots, appearance, region and language formats, menu bar, Control Center, window management, Dock pinned apps, default app handlers, and system behavior—including hidden preferences that System Settings doesn't expose (Dock auto-hide delay and animation speed, dimming hidden apps, POSIX paths in Finder titles, `.DS_Store` hygiene on network and USB volumes, and more). Structured settings—system keyboard shortcuts, text replacements, input sources—are captured as pretty-printed JSON inside the TOML, and per-host settings (Control Center modules, screen saver) are read and written with `defaults -currentHost`.

## What it deliberately does not capture

Settings that live outside `defaults` need different mechanisms and are out of scope today: power management (`pmset`), Software Update automation and Time Machine (system-level, `sudo`), timezone (`systemsetup`), Night Shift, per-app notification preferences, login items, network and Bluetooth configuration, and Finder sidebar contents. Third-party apps' own preferences (Alfred, Karabiner, and so on) are their own domains—sync those with the apps' own export tooling or dotfiles. Some captured values come with caveats noted in the file itself: text replacements also sync via iCloud, and Control Center placement codes are opaque values managed by macOS.

## Usage

```bash
# Snapshot the current machine's settings to battlestation.toml
battlestation capture

# See how the live system differs from the file
battlestation diff

# Make the system match the file (restarts Dock/Finder/SystemUIServer as needed)
battlestation apply

# Preview without changing anything, or skip the confirmation prompt
battlestation apply --dry-run
battlestation apply --yes

# Check the file for problems; --fix removes unknown entries and rewrites canonically
battlestation doctor
battlestation doctor --fix

# Inspect and edit the file without opening it (great for scripts and agents)
battlestation list --json
battlestation get dock.icon-size
battlestation set dock.icon-size 48
battlestation unset dock.icon-size

# Machine-readable diff/apply for scripts and UIs
battlestation diff --json
battlestation apply --json --yes

# Detailed help for any command
battlestation apply --help

# All commands accept an explicit path
battlestation capture --file ~/settings/macbook.toml
```

`apply` is declarative: settings present in the TOML are written, and registry settings absent from the TOML (commented out) that are set on the system are deleted, restoring the macOS default. It shows the full change list and asks for confirmation before touching anything—`--yes` skips the prompt for scripted runs.

Before writing anything, `apply` saves a full snapshot of the pre-apply state next to your file (`battlestation.undo.toml`, gitignored)—revert any apply with `battlestation apply --file battlestation.undo.toml`. `diff` and `apply` also take `--json` for machine consumption (`apply --json` requires `--yes`), so scripts, agents, and a future UI all speak the same protocol.

During development, run the same commands with `bun run src/index.ts <command>`, or use the repo shortcuts `bun run capture` and `bun run apply`, which operate on the gitignored `tmp/battlestation.toml` scratch file.

The captured TOML is fully annotated—every setting carries a comment explaining what it does and what its values mean, and settings that aren't set on the machine appear as commented-out keys so the file documents everything it can manage:

```toml
[keyboard]

# How fast a held key repeats. Lower is faster; 1 is faster than System Settings allows (its fastest is 2).
key-repeat-rate = 1

[dock]

# Seconds the pointer must rest at the screen edge before the hidden Dock appears. 0 shows it instantly.
auto-hide-delay = 0.0
```

Edit the file by hand, keep it in version control, and `apply` it on a fresh machine. `apply` only touches settings that actually differ, restarts the affected processes once, and tells you when a change needs a re-login to take full effect.

## MCP server

`battlestation mcp` runs the tool as a STDIO [Model Context Protocol](https://modelcontextprotocol.io) server, exposing every capability as a tool—`capture`, `diff`, `apply`, `doctor`, `list_settings`, `get_setting`, `set_setting`, and `unset_setting`—backed by the exact same command implementations as the CLI. Apply runs without an interactive prompt; the MCP client's tool-approval flow is the confirmation, and the undo snapshot is still written first. Register it with Claude Code:

```bash
claude mcp add battlestation -- npx battlestation mcp
```

## Value domains and validation

Every enumerated or bounded setting carries its legal values as data—`choices` with human labels, numeric `range`s with units—and the TOML legend comments are generated from that data, so they can never drift from what the tool validates. `doctor` checks values against these domains and reports out-of-domain values as advisory `[warning]`s (exit 0) rather than blocking errors: macOS often accepts values beyond what System Settings offers, and the file records what your system actually stores. Settings whose misuse can bite (keyboard shortcuts, input sources, default app handlers) are flagged `risk: caution` in the registry and surfaced in `--json` output.

## Using it as a library

The package exports the full engine alongside the CLI: `registry` (with labels, descriptions, choices, ranges, and risk metadata per setting), `captureToml`, `diffSettings`, `applyChanges` (with a per-change progress callback), `readSetting`/`writeSetting`, and the TOML analyze/render functions. The CLI is a thin shell over these—anything it does, a menu-bar app or script can do in-process.

## How it works

Everything is driven by a declarative registry in `src/settings/`—each entry maps a friendly TOML address (like `dock.auto-hide-delay`) to a `defaults` domain and key, a value type, a human description, and the process that must restart for the change to stick. `capture` reads each key with `defaults read`, `apply` writes with `defaults write` (mirroring domains like the Bluetooth trackpad where macOS keeps duplicates), and the TOML is emitted by hand so every key keeps its documentation.

## Releases

Publishing a GitHub Release triggers `.github/workflows/executables.yaml`, which compiles standalone macOS executables (`bun build --compile`, Apple Silicon and Intel) and attaches them to the release as `battlestation-darwin-{arm64,x64}.tar.gz`. No Bun or Node required on the target machine.

## Development

```bash
bun install
bun test              # tests (100% coverage enforced)
bun run check         # format check + lint + typecheck
bun run validate      # the full gate, including build and package checks
bun run build         # dual Node/Bun bundles in dist/
```

## License

MIT
