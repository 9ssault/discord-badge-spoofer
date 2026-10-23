#!/usr/bin/env bash
# Badges Spoofer — one-shot setup for Termux / Linux / macOS
set -euo pipefail
cd "$(dirname "$0")"

echo
echo "  ============================================================"
echo "     BADGES SPOOFER  —  SETUP (Termux / Linux / macOS)"
echo "  ============================================================"
echo

IS_TERMUX=0
if [ -n "${PREFIX:-}" ] && [ -d "$PREFIX/bin" ] && command -v termux-info >/dev/null 2>&1; then
  IS_TERMUX=1
elif [ -d /data/data/com.termux ]; then
  IS_TERMUX=1
fi

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local ver major
    ver=$(node -v 2>/dev/null || echo "?")
    echo "  [+] Node.js found: $ver"
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
    if ! command -v node >/dev/null 2>&1; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
    fi
  elif command -v brew >/dev/null 2>&1; then
    brew install node
  else
    echo "  [!] Install Node.js 18+ manually, then re-run."
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
echo "  [*] Zero runtime deps — skipping heavy npm install"
npm install --omit=dev 2>/dev/null || true
mkdir -p data profiles debug

echo
echo "  ============================================================"
echo "     READY"
echo "  ============================================================"
echo
echo "  Interactive:    node index.js"
echo "  Auto all:       node index.js --auto --mode all --hours 2 --titles 40"
echo "  Next tier:      node index.js --auto --mode next"
echo "  Drip pace:      node index.js --auto --mode playtime --pace drip"
echo "  Target hours:   node index.js --auto --mode playtime --target 500"
echo "  Preset:         node index.js --auto --preset max-variety"
echo "  Profile:        node index.js --profile alt"
echo
echo "  Update later:   git pull --ff-only   (keeps vault.json / profiles)"
echo
echo "  Env (optional): DISCORD_TOKEN  CF_CLEARANCE_COOKIE  SPOOF_HOURS  SPOOF_TITLES"
echo

if [ -f vault.json ] || [ -n "${DISCORD_TOKEN:-}" ]; then
  exec node index.js "$@"
else
  exec node index.js
fi
