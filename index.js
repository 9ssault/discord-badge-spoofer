#!/usr/bin/env node
"use strict";

/**
 * Badges Spoofer — interactive + auto CLI
 *
 * node index.js
 * node index.js --auto --mode all --hours 2 --titles 40
 * node index.js --auto --mode stream --hours 50 --pace drip
 * node index.js --auto --preset max-variety
 * node index.js --auto --target 500 --mode playtime
 * node index.js --profile alt
 */

const vault = require("./src/vault");
const session = require("./src/session");
const gamesMod = require("./src/games");
const features = require("./src/features");
const ui = require("./src/ui");
const auth = require("./src/auth");
const envstore = require("./src/envstore");
const badges = require("./src/badges");
const { CH, info, pass, fail, warn, BULLET, blank, line } = require("./src/log");
const { PATHS, ENDPOINTS, PRESETS } = require("./src/config");
const { ORCA } = require("./src/banner");
const fmt = require("./src/format");

const ctx = { games: [] };

function parseArgs(argv) {
  const args = {
    auto: false,
    hours: null,
    titles: null,
    dry: false,
    help: false,
    mode: "playtime",
    pace: null,
    preset: null,
    target: null,
    profile: null,
    filter: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--auto" || a === "-a") args.auto = true;
    else if (a === "--dry" || a === "--dry-run") args.dry = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--hours" || a === "-H") args.hours = Number(argv[++i]);
    else if (a === "--titles" || a === "-t") args.titles = Number(argv[++i]);
    else if (a === "--mode" || a === "-m") args.mode = String(argv[++i] || "playtime").toLowerCase();
    else if (a === "--pace") args.pace = String(argv[++i] || "").toLowerCase();
    else if (a === "--preset") args.preset = String(argv[++i] || "").toLowerCase();
    else if (a === "--target") args.target = Number(argv[++i]);
    else if (a === "--profile") args.profile = String(argv[++i] || "");
    else if (a === "--filter") args.filter = String(argv[++i] || "").toLowerCase();
  }
  return args;
}

function quip() {
  return ORCA.quips[Math.floor(Math.random() * ORCA.quips.length)];
}

function seedFromEnv() {
  envstore.loadQuiet();
  const s = vault.load();
  let changed = false;
  const tok = process.env.DISCORD_TOKEN || process.env.TOKEN || "";
  const ck = process.env.CF_CLEARANCE_COOKIE || process.env.COOKIE || "";
  if (tok && !s.token) {
    s.token = tok.trim();
    changed = true;
  }
  if (ck && !s.cookie) {
    s.cookie = ck.trim();
    changed = true;
  }
  if (changed) {
    vault.save();
    envstore.sync({ token: s.token, cookie: s.cookie });
  }
}

async function bootstrap({ interactive }) {
  blank();
  seedFromEnv();
  const s = vault.load();
  info(`vault ${CH.dim}${BULLET}${CH.reset} ${PATHS.vault}  profile=${s.activeProfile}`);
  info(`platform ${CH.dim}${BULLET}${CH.reset} ${process.platform} / node ${process.versions.node}`);
  blank();

  if (!s.token) {
    if (!interactive) {
      fail("DISCORD_TOKEN missing");
      return false;
    }
    const tok = await ui.ask(`  ${CH.dim}token:${CH.reset} `);
    if (!tok) {
      fail("token required");
      return false;
    }
    s.token = tok;
    vault.save();
    envstore.sync({ token: tok });
    pass("token stored");
  } else pass(`token loaded (${auth.userIdFromToken(s.token) || "?"})`);

  if (!s.cookie) {
    if (!interactive) {
      fail("CF_CLEARANCE_COOKIE missing");
      return false;
    }
    const ck = await ui.ask(`  ${CH.dim}cookie:${CH.reset} `);
    if (!ck) {
      fail("cookie required");
      return false;
    }
    s.cookie = ck;
    vault.save();
    envstore.sync({ cookie: ck });
    pass("cookie stored");
  } else pass("cookie loaded");

  if (!s.fingerprint) {
    try {
      const uid = auth.userIdFromToken(s.token) || "0";
      s.fingerprint = auth.syntheticFingerprint(uid);
      vault.save();
      pass(`synthetic fingerprint (${s.fingerprint.length} chars)`);
    } catch (e) {
      warn(String(e.message || e));
    }
  }

  blank();
  info("loading catalog…");
  ctx.games = await gamesMod.loadGames();
  if (!ctx.games.length) {
    fail("catalog empty");
    return false;
  }
  pass(`${ctx.games.length} titles`);

  blank();
  try {
    await session.begin();
    if (!vault.tokenFresh()) await session.renew();
    pass("session established");
  } catch (e) {
    fail(String(e.message || e));
    return false;
  }
  blank();
  info(quip());
  return true;
}

async function runAuto(args) {
  const s = vault.load();
  if (args.dry) s.settings.dryRun = true;
  if (args.pace === "drip" || args.pace === "aggressive") s.settings.pace = args.pace;
  if (args.filter) s.settings.catalogFilter = args.filter;
  vault.save();

  let mode = args.mode || "playtime";
  let hours =
    Number.isFinite(args.hours) && args.hours > 0
      ? args.hours
      : Number(process.env.SPOOF_HOURS) || s.settings.hoursDefault || 1;
  let titlesWanted =
    Number.isFinite(args.titles) && args.titles > 0
      ? Math.floor(args.titles)
      : Number(process.env.SPOOF_TITLES) || Math.min(50, ctx.games.length);

  if (args.preset && PRESETS[args.preset]) {
    const p = PRESETS[args.preset];
    mode = p.mode || mode;
    if (p.hours != null) hours = p.hours;
    if (p.titles != null) titlesWanted = p.titles;
    info(`preset ${args.preset}`);
  }

  // --target N means forge until vault hours reach N (playtime) or stream hours
  if (Number.isFinite(args.target) && args.target > 0) {
    if (mode === "stream") {
      const need = Math.max(0, args.target - (s.totals.streamHours || 0));
      if (need <= 0) {
        pass(`already at/above stream target ${args.target}h`);
        return;
      }
      hours = need;
      info(`target stream ${args.target}h · need ${fmt.hours(need)}`);
    } else if (mode === "variety") {
      const need = Math.max(0, Math.floor(args.target) - (s.totals.varietyTitles || 0));
      if (need <= 0) {
        pass(`already at variety target`);
        return;
      }
      titlesWanted = need;
    } else {
      const need = Math.max(0, args.target - s.totals.hours);
      if (need <= 0) {
        pass(`already at/above playtime target ${args.target}h`);
        return;
      }
      // spread across titles
      titlesWanted = Math.min(titlesWanted, Math.max(5, Math.ceil(need)));
      hours = need / titlesWanted;
      info(`target playtime ${args.target}h · need ${fmt.hours(need)} across ${titlesWanted} titles`);
    }
  }

  const catalog = features.filteredCatalog(ctx.games);
  info(`auto mode=${mode} pace=${s.settings.pace} filter=${s.settings.catalogFilter}`);

  if (mode === "stream" || mode === "all") {
    const streamHours = mode === "stream" ? hours : hours;
    const sessions = Math.min(100, Math.max(1, Math.ceil(streamHours / 10)));
    await features.executeStreamForge(features.pickRotating(catalog, sessions), streamHours, sessions);
  }
  if (mode === "variety" || mode === "all") {
    await features.executeForge(features.pickRotating(catalog, titlesWanted), 1 / 60, "variety");
  }
  if (mode === "playtime" || mode === "all") {
    await features.executeForge(features.pickRotating(catalog, titlesWanted), hours, "playtime");
  }
  if (mode === "next") {
    await features.forgeToNextTier(ctx);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`
  badges spoofer

  node index.js
  node index.js --auto --mode playtime|stream|variety|all|next
  node index.js --auto --hours 2 --titles 40 --pace aggressive|drip
  node index.js --auto --target 500 --mode playtime
  node index.js --auto --preset max-variety|quick-play|dump-stream|…
  node index.js --profile <name>
  node index.js --filter all|verified|steam|no-launcher
  node index.js --dry

  Env: DISCORD_TOKEN  CF_CLEARANCE_COOKIE  SPOOF_HOURS  SPOOF_TITLES
`);
    return;
  }

  if (args.profile) {
    vault.switchProfile(args.profile);
    info(`profile → ${args.profile}`);
  }

  const ok = await bootstrap({ interactive: !args.auto });
  if (!ok) return;

  if (args.auto) {
    await runAuto(args);
    blank();
    line();
    info("auto run finished");
    return;
  }

  for (;;) {
    ui.paintMenu();
    const again = await ui.showMenu(ctx);
    if (!again) break;
  }
  blank();
  line();
  info("shutting down");
}

main()
  .catch((err) => {
    if (err && (err.name === "AbortError" || err.code === "ERR_USE_AFTER_CLOSE")) {
      console.log();
      fail("interrupted");
    } else console.error(err);
  })
  .finally(() => ui.closeRl());

process.on("SIGINT", () => {
  console.log();
  fail("interrupted");
  ui.closeRl();
  process.exit(130);
});
