# Badges Spoofer

CLI that inflates Discord **game-time**, **variety**, and **streaming** profile badges by posting client-like events to `/api/v9/science`.

**Termux · Linux · macOS · Windows** · zero runtime npm deps · interactive **or** fully automatic.

> **Violates Discord ToS.** Account loss possible. Educational use only.

---

## Quick start (Termux)

```bash
pkg update -y && pkg install -y nodejs git
git clone https://github.com/9ssault/discord-badge-spoofer.git
cd discord-badge-spoofer
bash setup.sh
node index.js
```

### Update without losing credentials

```bash
cd discord-badge-spoofer && git pull --ff-only && node index.js
```

`vault.json`, `profiles/`, `checkpoint.json` are gitignored.

---

## Features

| Feature | Notes |
|---|---|
| **Playtime / variety / stream forge** | science events |
| **Badge ladder planner** | menu 7 — tiers + vault progress |
| **Forge to next tier** | menu 6 — auto-compute gap |
| **Target mode** | `--target 500` stop at vault hours |
| **Aggressive or drip pace** | settings / `--pace drip` |
| **Retry + resume** | exponential backoff + `checkpoint.json` |
| **Multi-profile** | `profiles/` + menu tools → profiles |
| **Export / import vault** | optional secret redaction |
| **Progress bar + ETA** | large runs |
| **Catalog filters** | all / verified / steam / no-launcher |
| **Presets** | `--preset max-variety` etc. |
| **Journal stats** | success rate by mode |
| **Debug dumps** | `debug/` on failed science posts |
| **Super-props** | cordapi + local fallback |

**Not included:** full dual-token real Go Live (item 13). Stream remains pure science; Discord may still require a real viewer for the badge.

---

## Menu

| Key | Action |
|---|---|
| 1 | forge playtime |
| 2 | forge on titles (search) |
| 3 | forge stream hours |
| 4 | forge games played (variety) |
| 5 | forge all badges |
| 6 | forge to **next tier** |
| 7 | **badge ladder** |
| 8 | renew session |
| 9 | bind fingerprint |
| 0 | tools — probe, catalog, settings, journal, ladder, **profiles**, checkpoint |
| x | exit |

---

## CLI

```bash
node index.js --auto --mode playtime --hours 2 --titles 40
node index.js --auto --mode stream --hours 50 --pace drip
node index.js --auto --mode variety --titles 100
node index.js --auto --mode all --hours 2 --titles 40
node index.js --auto --target 500 --mode playtime
node index.js --auto --preset max-variety
node index.js --auto --preset dump-stream
node index.js --profile alt --auto --mode playtime --hours 1
node index.js --filter steam --auto --titles 30
node index.js --dry
```

| Flag | Meaning |
|---|---|
| `--auto` | non-interactive |
| `--mode` | `playtime` \| `stream` \| `variety` \| `all` \| `next` |
| `--hours` | hours per title / total stream hours |
| `--titles` | catalog count |
| `--target` | stop when vault reaches N hours (or N titles for variety) |
| `--pace` | `aggressive` (default) or `drip` |
| `--preset` | `max-variety` `quick-play` `dump-play` `dump-stream` … |
| `--profile` | switch/create named profile |
| `--filter` | `all` `verified` `steam` `no-launcher` |
| `--dry` | send nothing |

Env: `DISCORD_TOKEN` · `CF_CLEARANCE_COOKIE` · `SPOOF_HOURS` · `SPOOF_TITLES`

---

## Settings (menu 0 → c)

| Setting | Default |
|---|---|
| batch size | 50 |
| batch pause | 300 ms |
| wobble | on (±3%) |
| dry run | off |
| pace | aggressive \| drip |
| catalog filter | all |
| max retries | 4 |
| debug dump | off |

**Drip** inserts long pauses between batches (default 15 min) for slower, safer runs.

---

## Multi-profile

```bash
node index.js --profile main
# tools → profiles → save as / switch / export / import
```

Profiles live under `profiles/<name>.json`. Active state is always `vault.json`.

---

## Resume

Interrupted forges write `checkpoint.json`. Re-run the **same mode**; it continues from the saved index. Clear via tools → checkpoint.

---

## Disclaimer

> This forges Discord telemetry and violates ToS. Use at your own risk.

**Badges Spoofer** · 2026 · MIT
