#!/usr/bin/env bash
# PreToolUse hook (Write): block writing to .env files so secrets aren't
# clobbered or created accidentally. Fail-safe — if jq is missing it allows the
# write (exit 0) rather than blocking everything in a fresh environment.
set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0

file_path=$(jq -r '.tool_input.file_path // empty')
base=$(basename "$file_path")

case "$base" in
  .env | .env.*)
    if [[ "$base" != ".env.example" ]]; then
      echo "Refusing to write to ${base}: edit it manually to avoid leaking secrets." >&2
      exit 2
    fi
    ;;
esac

exit 0
