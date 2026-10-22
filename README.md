# Discord badge spoofer

**spoof your discord playtime & badges** — CLI that inflates playtime and games-played badges by replaying the same telemetry events the real client sends to `/api/v9/science`.

Works on **Termux (Android)**, Linux, macOS, and Windows. Zero npm runtime dependencies. Interactive menu **or** fully automatic mode.

> **This violates Discord ToS.** Account loss is possible. Educational use only.

---

## Quick start (Termux)

```bash
pkg update -y && pkg install -y nodejs git
git clone https://github.com/9ssault/discord-badge-spoofer.git
cd discord-badge-spoofer
bash setup.sh
```

Or manually:

```bash
node index.js                 # interactive
node index.js --auto          # fully automatic
node index.js --auto --hours 2 --titles 40
node index.js --auto --dry    # dry-run (send nothing)
```

### Fully automatic (no prompts after first setup)

```bash
export DISCORD_TOKEN='your_token'
export CF_CLEARANCE_COOKIE='your_cf_clearance'
export SPOOF_HOURS=1
export SPOOF_TITLES=50
node index.js --auto
```

Credentials are stored in `vault.json` after the first run, so you only need env vars once (or paste interactively once).

---

## Features

- **Inflate playtime & games-played badges** via real `/science` telemetry
- **Bulk + targeted forging** with rotation so recently-forged titles are deprioritized
- **Full Discord detectables catalog** (thousands of titles)
- **Cross-platform fingerprint** — real PE fingerprint on Windows; stable synthetic fingerprint on Termux/Linux/macOS
- **Session management** — auto-mints / renews analytics tokens
- **Interactive CLI** (menu 1–9) **and** `--auto` mode
- **Dry-run**, wobble (±3%), batch tuning, journal

---

## Menu

| # | Option | What it does |
|---|---|---|
| 1 | forge playtime | batch-claim hours across catalog |
| 2 | forge on titles | search + pick exact titles |
| 3 | renew session | re-mint analytics token / swap cookie |
| 4 | bind fingerprint | Windows PE or synthetic (auto on Termux) |
| 5 | probe stats | what Discord / vault think |
| 6 | catalog scan | search detected titles |
| 7 | settings | batches, wobble, dry-run |
| 8 | journal | recent forge history |
| 9 | exit | |

---

## Getting credentials

### Token
1. discord.com → log in → `Ctrl+Shift+I` → Network → filter `/api` → refresh  
2. Any request → Headers → copy `Authorization`

### cf_clearance
1. Application → Cookies → `https://discord.com` → copy `cf_clearance`  
Cookie expires; use menu **3** to refresh.

---

## Settings (menu 7 / defaults)

| Setting | Default | Description |
|---|---|---|
| batch size | 50 | titles per `/science` request |
| batch pause | 300 ms | between requests |
| wobble | on | ±3% hour drift |
| dry run | off | build events, send nothing |
| default hours | 1 | fallback for prompts / auto |

---

## How it works

Posts `launch_game` + `running_game_heartbeat` triplets to `/api/v9/science`. `duration_tracked_ms` is not validated server-side.

---

## Project layout

```
index.js          entry (interactive + --auto)
setup.sh          Termux/Linux one-shot
setup.bat         Windows one-shot
src/              auth, forge, science, session, ui, …
data/games.json   catalog cache (auto-downloaded)
vault.json        local credentials + counters (gitignored)
```

---

## Disclaimer

**This tool violates Discord's terms of service.** Forging telemetry can get accounts terminated. Use at your own risk.
