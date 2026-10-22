#!/usr/bin/env bash
# Discord Badge Spoofer — one-shot setup for Termux / Linux / macOS
set -euo pipefail
cd "$(dirname "$0")"

echo
echo "  ============================================================"
echo "     DISCORD BADGE SPOOFER  —  SETUP (Termux / Linux)"
echo "  ============================================================"
echo

# Detect Termux
IS_TERMUX=0
if [ -n "${PREFIX:-}" ] && [ -d "$PREFIX/bin" ] && command -v termux-info >/dev/null 2>&1; then
  IS_TERMUX=1
elif [ -d /data/data/com.termux ]; then
  IS_TERMUX=1
fi

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local ver
    ver=$(node -v 2>/dev/null || echo "?")
    echo "  [+] Node.js found: $ver"
    # need >= 18
    local major
    major=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
    if [ "$major" -ge 18 ] 2>/dev/null; then
      return 0
    fi
    echo "  [!] Node $ver is too old (need 18+). Upgrading..."
  else
    echo "  [*] Node.js not found — installing..."
  fi

  if [ "$IS_TERMUX" = 1 ]; then
    pkg update -y || true
    pkg install -y nodejs || pkg install -y nodejs-lts
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y nodejs npm || true
    # fallback: nodesource if still missing
    if ! command -v node >/dev/null 2>&1; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
    fi
  elif command -v brew >/dev/null 2>&1; then
    brew install node
  else
    echo "  [!] Install Node.js 18+ manually, then re-run this script."
    exit 1
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "  [!] Node still missing."
    exit 1
  fi
  echo "  [+] Node.js: $(node -v)"
}

ensure_node

echo
echo "  [*] Installing deps (zero runtime deps — npm install is a no-op)..."
npm install --omit=dev 2>/dev/null || true

# Make data dir for catalog cache
mkdir -p data

echo
echo "  ============================================================"
echo "     READY"
echo "  ============================================================"
echo
echo "  Interactive:   node index.js"
echo "  Fully auto:    node index.js --auto --hours 1 --titles 30"
echo
echo "  Optional env (skip prompts after first run):"
echo "    export DISCORD_TOKEN='your_token'"
echo "    export CF_CLEARANCE_COOKIE='your_cf_clearance'"
echo "    export SPOOF_HOURS=1"
echo "    export SPOOF_TITLES=50"
echo
echo "  Press Ctrl+C to stop at any time."
echo

# If token already in vault or env, jump straight in; otherwise interactive
if [ -f vault.json ] || [ -n "${DISCORD_TOKEN:-}" ]; then
  exec node index.js "$@"
else
  exec node index.js
fi
