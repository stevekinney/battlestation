#!/usr/bin/env bash
# PostToolUse hook: format the file Claude just edited so it always matches the
# project's Prettier config. Fail-safe — never blocks or errors the session:
# no-ops if jq or Prettier aren't available (e.g. before `bun install`), and
# skips file types Prettier doesn't understand via --ignore-unknown.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0

file_path=$(jq -r '.tool_input.file_path // empty')
[[ -z "$file_path" ]] && exit 0

prettier="${CLAUDE_PROJECT_DIR:-.}/node_modules/.bin/prettier"
[[ -x "$prettier" ]] || exit 0

"$prettier" --write --ignore-unknown "$file_path" >/dev/null 2>&1 || true
