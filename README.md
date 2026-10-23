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
```

### Update without losing credentials

```bash
cd discord-badge-spoofer && git pull --ff-only && node index.js
```

`vault.json`, `profiles/`, `checkpoint.json`, `debug/` are gitignored.

---

## Interactive menu

```
── FORGE ────────────────────────────────
  1   playtime              game-time hours across catalog
  2   on titles             search catalog · pick exact games
  3   stream hours          video_stream science (best-effort)
  4   games played          variety badge · ~1 min / title
  5   all badges            playtime + stream + variety
  6   next tier             auto-fill gap to next ladder step

── PROGRESS ─────────────────────────────
  7   badge ladder          tiers · vault estimates · next gap

── SESSION ──────────────────────────────
  8   renew session         re-mint analytics · swap cookie
  9   fingerprint           Windows PE or synthetic (Termux)

── TOOLS ────────────────────────────────
 10   tools…                probe · catalog · settings · journal
                            profiles · checkpoint
  x   exit
```

Status strip shows **profile**, **auth**, **session**, **pace**, vault hours (play / stream / variety), dry-run flag, and any **checkpoint**.

---

## CLI (auto)

```bash
node index.js --auto --mode playtime --hours 2 --titles 40
node index.js --auto --mode stream --hours 50 --pace drip
node index.js --auto --mode variety --titles 100
node index.js --auto --mode all --hours 2 --titles 40
node index.js --auto --mode next
node index.js --auto --target 500 --mode playtime
node index.js --auto --preset max-variety
node index.js --profile alt --auto --mode playtime --hours 1
node index.js --filter steam --auto --titles 30
node index.js --dry
```

| Flag | Meaning |
|---|---|
| `--auto` | non-interactive |
| `--mode` | `playtime` \| `stream` \| `variety` \| `all` \| `next` |
| `--hours` / `-H` | hours per title or total stream hours |
| `--titles` / `-t` | catalog count |
| `--target` | stop when vault reaches N hours (or N titles for variety) |
| `--pace` | `aggressive` (default) or `drip` |
| `--preset` | `max-variety` `quick-play` `dump-play` `dump-stream` |
| `--profile` | switch/create named profile |
| `--filter` | `all` `verified` `steam` `no-launcher` |
| `--dry` | send nothing |

Env: `DISCORD_TOKEN` · `CF_CLEARANCE_COOKIE` · `SPOOF_HOURS` · `SPOOF_TITLES`

---

## Features

| Feature | Where |
|---|---|
| Playtime / variety / stream forge | menu 1–5 |
| Badge ladder + next-tier | menu 6–7 |
| Aggressive or drip pace | settings or `--pace` |
| Retry + checkpoint resume | automatic |
| Multi-profile + export/import | tools (10 → f) |
| Catalog filters | settings / `--filter` |
| Progress bar + ETA | during forge |
| Journal stats | tools (10 → d) |
| Debug dumps on fail | settings debug on → `debug/` |

**Not included:** dual-token real Go Live. Stream is pure science only.

---

## Settings (menu 10 → c)

| Setting | Default |
|---|---|
| batch size | 50 |
| batch pause | 300 ms |
| wobble | on |
| dry run | off |
| pace | aggressive \| drip |
| drip pause | 15 min between batches |
| catalog filter | all |
| max retries | 4 |
| debug dump | off |

---

## Disclaimer

> Forges Discord telemetry and violates ToS. Use at your own risk.

**Badges Spoofer** · v3 · MIT
