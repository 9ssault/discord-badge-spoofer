#!/usr/bin/env node
"use strict";

/**
 * playtime / stream / variety badge forge.
 *
 * node index.js
 * node index.js --auto --mode all --hours 2 --titles 40
 * node index.js --auto --mode stream --hours 5
 * node index.js --auto --mode variety --titles 100
 */

const vault = require("./src/vault");
const session = require("./src/session");
const gamesMod = require("./src/games");
const features = require("./src/features");
const ui = require("./src/ui");
const auth = require("./src/auth");
const envstore = require("./src/envstore");
const { CH, info, pass, fail, warn, BULLET, blank, line } = require("./src/log");
const { PATHS, ENDPOINTS } = require("./src/config");
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
    mode: "playtime", // playtime | stream | variety | all
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--auto" || a === "-a") args.auto = true;
    else if (a === "--dry" || a === "--dry-run") args.dry = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--hours" || a === "-H") args.hours = Number(argv[++i]);
    else if (a === "--titles" || a === "-t") args.titles = Number(argv[++i]);
    else if (a === "--mode" || a === "-m") args.mode = String(argv[++i] || "playtime").toLowerCase();
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
  const authState = s.token ? (s.cookie ? "ready" : "cookie missing") : "no token";

  info(`vault ${CH.dim}${BULLET}${CH.reset} ${PATHS.vault}`);
  info(`auth ${CH.dim}${BULLET}${CH.reset} ${authState}`);
  info(`platform ${CH.dim}${BULLET}${CH.reset} ${process.platform} / node ${process.versions.node}`);
  if (s.totals.titles > 0) {
    info(
      `history ${CH.dim}${BULLET}${CH.reset} ${fmt.int(s.totals.titles)} titles ${CH.dim}/${CH.reset} ${fmt.hours(s.totals.hours)} forged`
    );
  }
  blank();

  if (!s.token) {
    if (!interactive) {
      fail("DISCORD_TOKEN missing (set env or run interactive once)");
      return false;
    }
    info("paste your discord account token");
    const tok = await ui.ask(`  ${CH.dim}token:${CH.reset} `);
    if (!tok) {
      fail("a token is required");
      return false;
    }
    s.token = tok;
    vault.save();
    pass("token stored");
    envstore.sync({ token: tok });
  } else {
    pass(`token loaded ${CH.dim}(${auth.userIdFromToken(s.token) || "id unknown"})${CH.reset}`);
  }

  if (!s.cookie) {
    if (!interactive) {
      fail("CF_CLEARANCE_COOKIE missing (set env or run interactive once)");
      return false;
    }
    blank();
    info("paste your cf_clearance cookie header");
    info(`${CH.dim}discord.com -> devtools -> application -> cookies -> cf_clearance${CH.reset}`);
    const ck = await ui.ask(`  ${CH.dim}cookie:${CH.reset} `);
    if (!ck) {
      fail("a cookie is required");
      return false;
    }
    s.cookie = ck;
    vault.save();
    pass("cookie stored");
    envstore.sync({ cookie: ck });
  } else {
    pass("cookie loaded");
  }

  if (!s.fingerprint) {
    try {
      const uid = auth.userIdFromToken(s.token) || "0";
      s.fingerprint = auth.syntheticFingerprint(uid);
      vault.save();
      pass(`synthetic fingerprint bound ${CH.dim}(${s.fingerprint.length} chars)${CH.reset}`);
    } catch (e) {
      warn(`fingerprint skipped: ${e.message || e}`);
    }
  }

  blank();
  info("loading game catalog...");
  ctx.games = await gamesMod.loadGames();
  if (!ctx.games.length) {
    fail("couldn't load the game catalog");
    info(`tried ${PATHS.gameList} and ${ENDPOINTS.catalog}`);
    return false;
  }
  pass(`${CH.orange}${ctx.games.length}${CH.reset} titles indexed`);

  blank();
  info("establishing session...");
  try {
    await session.begin();
    if (!vault.tokenFresh()) await session.renew();
    pass("session established");
  } catch (e) {
    fail(String(e && e.message ? e.message : e));
    warn("if 401/403: refresh token + cf_clearance cookie (menu 6)");
    return false;
  }

  blank();
  info(quip());
  return true;
}

async function runAuto(args) {
  const s = vault.load();
  if (args.dry) s.settings.dryRun = true;
  const hours =
    Number.isFinite(args.hours) && args.hours > 0
      ? args.hours
      : Number(process.env.SPOOF_HOURS) || s.settings.hoursDefault || 1;
  const titlesWanted =
    Number.isFinite(args.titles) && args.titles > 0
      ? Math.floor(args.titles)
      : Number(process.env.SPOOF_TITLES) || Math.min(50, ctx.games.length);

  const mode = args.mode || "playtime";
  info(`auto mode=${mode} ${CH.dim}${BULLET}${CH.reset} titles=${titlesWanted} hours=${fmt.hours(hours)}`);

  if (mode === "stream" || mode === "all") {
    const sessions = Math.min(12, Math.max(1, Math.ceil(hours)));
    const picked = features.pickRotating(ctx.games, sessions);
    await features.executeForge(picked, hours / sessions, "stream");
  }
  if (mode === "variety" || mode === "all") {
    const picked = features.pickRotating(ctx.games, titlesWanted);
    await features.executeForge(picked, 1 / 60, "variety");
  }
  if (mode === "playtime" || mode === "all") {
    const picked = features.pickRotating(ctx.games, titlesWanted);
    if (!picked.length) {
      fail("no titles to forge");
      return;
    }
    await features.executeForge(picked, hours, "playtime");
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`
  discord-badge-spoofer  v2.2

  node index.js
  node index.js --auto --mode playtime --hours 2 --titles 40
  node index.js --auto --mode stream --hours 5
  node index.js --auto --mode variety --titles 100
  node index.js --auto --mode all --hours 2 --titles 40
  node index.js --auto --dry

  Env: DISCORD_TOKEN  CF_CLEARANCE_COOKIE  SPOOF_HOURS  SPOOF_TITLES
`);
    return;
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
  info(`forged this session ${CH.dim}${BULLET}${CH.reset} thanks for flying orcabase`);
  line();
}

main()
  .catch((err) => {
    if (err && (err.name === "AbortError" || err.code === "ERR_USE_AFTER_CLOSE")) {
      console.log();
      fail("interrupted");
    } else {
      console.error(err);
    }
  })
  .finally(() => {
    ui.closeRl();
  });

process.on("SIGINT", () => {
  console.log();
  fail("interrupted");
  ui.closeRl();
  process.exit(130);
});
