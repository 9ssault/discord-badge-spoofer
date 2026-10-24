#!/usr/bin/env bash
# 9ssault / Ultimate Edition. Forward arguments; default startup is offline.
set -euo pipefail
cd "$(dirname "$0")"

printf '\n  9ssault / ULTIMATE EDITION\n  Offline preview by default. No packages to install.\n\n'
if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js 22 or newer is required: https://nodejs.org/\n' >&2
  exit 1
fi
if ! node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"; then
  printf 'Please upgrade to Node.js 22 or newer: https://nodejs.org/\n' >&2
  exit 1
fi
exec node index.js "$@"
