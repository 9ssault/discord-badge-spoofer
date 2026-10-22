# Discord badge spoofer

**Spoof Discord profile badges** — CLI that inflates **game-time**, **games-played (variety)**, and **streaming** hours by replaying the same telemetry the official client posts to `/api/v9/science`.

Works on **Termux (Android)**, Linux, macOS, and Windows. **Zero npm runtime dependencies.** Interactive menu **or** fully automatic mode.

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
node index.js                                    # interactive menu
node index.js --auto --mode playtime --hours 2 --titles 40
node index.js --auto --mode stream --hours 5
node index.js --auto --mode variety --titles 100
node index.js --auto --mode all --hours 2 --titles 40
node index.js --auto --dry                       # dry-run (send nothing)
```

### Update without losing token / cookie

`vault.json` is local and not tracked by git:

```bash
cd discord-badge-spoofer
git pull --ff-only
node index.js
```

### Fully automatic (no prompts after first setup)

```bash
export DISCORD_TOKEN='your_token'
export CF_CLEARANCE_COOKIE='your_cf_clearance'
export SPOOF_HOURS=1
export SPOOF_TITLES=50
node index.js --auto --mode all
```

Credentials are stored in `vault.json` after the first run, so you only need env vars once (or paste interactively once).

---

## Features

| Badge | How this tool targets it |
|---|---|
| **Game time** (hours played) | `launch_game` + `running_game_heartbeat` with custom `duration_tracked_ms` |
| **Game variety** (games played) | Many distinct titles, ~1 minute each |
| **Streaming** (hours streamed) | `video_stream_started` + `video_stream_ended` with duration *(best-effort — Discord may still require a real viewer)* |

Also included:

- **Bulk + targeted forging** with rotation (recently forged titles deprioritized)
- **Full Discord detectables catalog** (thousands of titles, cached under `data/`)
- **Cross-platform fingerprint** — real PE fingerprint on Windows; stable synthetic on Termux/Linux/macOS
- **Session management** — auto-mints / renews analytics tokens
- **Interactive CLI** and **`--auto`** with `--mode playtime|stream|variety|all`
- **Dry-run**, ±3% hour wobble, batch tuning, journal

---

## Menu

| # | Option | What it does |
|---|---|---|
| 1 | forge playtime | Game-time badge — hours across catalog titles |
| 2 | forge on titles | Search catalog and pick exact titles |
| 3 | forge stream hours | Streaming badge — `video_stream_*` events |
| 4 | forge games played | Variety badge — many titles, ~1 min each |
| 5 | forge all badges | Playtime + stream + variety in one run |
| 6 | renew session | Re-mint analytics token / swap `cf_clearance` |
| 7 | bind fingerprint | Windows PE or synthetic (auto on Termux) |
| 8 | tools submenu | Probe stats, catalog scan, settings, journal |
| 9 | exit | |

---

## CLI flags

```text
node index.js [options]

  --auto, -a              non-interactive run
  --mode, -m <name>       playtime | stream | variety | all   (default: playtime)
  --hours, -H <n>         hours per title / total stream hours
  --titles, -t <n>        how many catalog titles to use
  --dry, --dry-run        build events but send nothing
  --help, -h              show help
```

Env overrides (optional):

| Variable | Purpose |
|---|---|
| `DISCORD_TOKEN` | Account token |
| `CF_CLEARANCE_COOKIE` | Cloudflare clearance cookie |
| `SPOOF_HOURS` | Default hours for auto mode |
| `SPOOF_TITLES` | Default title count for auto mode |

---

## Getting credentials

### Token
1. Open [discord.com](https://discord.com) → log in  
2. `Ctrl+Shift+I` (or DevTools) → **Network** → filter `/api` → refresh  
3. Any request → **Headers** → copy `Authorization`

### cf_clearance
1. **Application** → **Cookies** → `https://discord.com`  
2. Copy the value of `cf_clearance`  

Cookie expires periodically — use menu **6** (or paste a new one on renew) when requests start failing with 401/403.

---

## Settings (menu 8 → settings)

| Setting | Default | Description |
|---|---|---|
| batch size | `50` | titles per `/science` request |
| batch pause | `300` ms | delay between batches |
| wobble | on | ±3% drift on logged hours |
| dry run | off | build events, send nothing |
| default hours | `1` | fallback for prompts / auto |

---

## How it works

1. Loads credentials from `vault.json` (or env / first-run prompts).
2. Mints an analytics token from `GET /users/@me?with_analytics_token=true`.
3. Builds client-like events and `POST`s them to `/api/v9/science`.
4. Discord accepts with `204`; badge tiers update after processing (often hours–days).

**Playtime / variety** use `launch_game` + `running_game_heartbeat`.  
**Streaming** uses `video_stream_started` + `video_stream_ended`. Streaming hours on real profiles normally need at least one viewer in a Go Live session — pure science forge is experimental.

---

## Project layout

```text
index.js            entry (interactive + --auto)
setup.sh            Termux / Linux one-shot
setup.bat           Windows one-shot
src/
  auth.js           token, headers, fingerprints
  science.js        playtime / stream / variety events
  forge.js          batch runner + journal
  features.js       menu flows
  session.js        analytics token lifecycle
  games.js          detectables catalog
  ui.js / log.js    interactive CLI
  vault.js          local state (token, cookie, totals)
data/games.json     catalog cache (auto-downloaded)
vault.json          credentials + counters (local only)
journal.jsonl       run history
```

---

## Requirements

| Requirement | Notes |
|---|---|
| **Node.js 18+** | native `fetch` |
| **Discord token** | pasted once, stored in vault |
| **`cf_clearance` cookie** | from discord.com cookies |

---

## FAQ

**Is this safe?** No. It violates Discord ToS. Your account, your risk.

**Will I get banned?** Possibly. Weird telemetry patterns or fingerprint mismatch can flag accounts. Prefer dry-run first, keep wobble on, avoid insane hour dumps.

**When do badges show up?** Often 1–2 days after events are accepted. Game-time tiers scale with total hours; variety needs several distinct titles; streaming is experimental via science alone.

**Where is my data?** Local only: `vault.json`, `journal.jsonl`, optional `.env`. Nothing is sent anywhere except Discord’s own API.

**Windows only?** No. Runs anywhere Node 18+ runs. Fingerprint binding uses a synthetic fingerprint on Termux/Linux/macOS.

---

## Disclaimer

> [!WARNING]
> **This tool violates Discord’s terms of service.** You are forging telemetry. Account termination is a real possibility — use at your own risk. For educational purposes only.

---

<div align="center">

**orcabase** · 2026 · MIT licensed

</div>
