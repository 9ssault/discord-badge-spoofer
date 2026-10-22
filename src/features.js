"use strict";

/**
 * feature flows: playtime, stream hours, games-played variety, all-badges, tools.
 */

const fs = require("fs");
const { CH, BULLET, info, pass, fail, warn, line, blank, plain, keyValue } = require("./log");
const { ORCA } = require("./banner");
const { LIMITS, PATHS } = require("./config");
const vault = require("./vault");
const fmt = require("./format");
const ui = require("./ui");
const session = require("./session");
const science = require("./science");
const forge = require("./forge");
const games = require("./games");
const auth = require("./auth");
const envstore = require("./envstore");

const QUIPS = () => ORCA.quips[Math.floor(Math.random() * ORCA.quips.length)];

function wobbleHours(h, enabled) {
  if (!enabled) return h;
  const drift = 1 + (Math.random() * 0.06 - 0.03);
  return Math.max(0.01, h * drift);
}

async function settle() {
  const { pause } = require("./log");
  await pause();
}

async function forgeBulk(ctx) {
  const { games: catalog } = ctx;
  if (!(await requireReady())) return;
  const s = vault.load();

  info(`catalog ${CH.dim}${BULLET}${CH.reset} ${CH.orange}${catalog.length}${CH.reset} titles`);
  const count = await ui.askNumber(
    `  ${CH.dim}titles this run${CH.reset} ${CH.dim}[all]:${CH.reset} `,
    catalog.length,
    { integer: true, min: 1 }
  );
  if (count === null) {
    fail("bad number");
    return await settle();
  }

  const hoursIn = await ui.askNumber(
    `  ${CH.dim}hours per title${CH.reset} ${CH.dim}[${s.settings.hoursDefault}]:${CH.reset} `,
    s.settings.hoursDefault
  );
  if (hoursIn === null) {
    fail("bad number");
    return await settle();
  }

  const picked = pickRotating(catalog, count);
  if (!picked.length) {
    fail("no titles selected");
    return await settle();
  }

  await executeForge(picked, hoursIn, "playtime");
}

async function forgeTitles(ctx) {
  const { games: catalog } = ctx;
  if (!(await requireReady())) return;
  const s = vault.load();

  const q = await ui.ask(`  ${CH.dim}search titles:${CH.reset} `);
  const matches = games.searchGames(catalog, q);
  if (!matches.length) {
    fail("no matches");
    return await settle();
  }

  info(`${matches.length} match${matches.length === 1 ? "" : "es"}`);
  const picked = await ui.chooseGames(matches);
  if (!picked.length) {
    info("nothing picked");
    return await settle();
  }

  const hoursIn = await ui.askNumber(
    `  ${CH.dim}hours per title${CH.reset} ${CH.dim}[${s.settings.hoursDefault}]:${CH.reset} `,
    s.settings.hoursDefault
  );
  if (hoursIn === null) {
    fail("bad number");
    return await settle();
  }

  await executeForge(picked, hoursIn, "playtime");
}

async function forgeStream(ctx) {
  const { games: catalog } = ctx;
  if (!(await requireReady())) return;
  const s = vault.load();

  warn("streaming badge needs hours streamed to other users — science events are best-effort");
  const hoursIn = await ui.askNumber(
    `  ${CH.dim}stream hours to claim${CH.reset} ${CH.dim}[${s.settings.hoursDefault}]:${CH.reset} `,
    s.settings.hoursDefault
  );
  if (hoursIn === null) {
    fail("bad number");
    return await settle();
  }

  // split hours across a few stream sessions on different titles
  const sessions = Math.min(12, Math.max(1, Math.ceil(hoursIn)));
  const per = hoursIn / sessions;
  const picked = pickRotating(catalog, sessions);
  if (!picked.length) {
    fail("no titles");
    return await settle();
  }

  await executeForge(picked, per, "stream");
}

async function forgeVariety(ctx) {
  const { games: catalog } = ctx;
  if (!(await requireReady())) return;

  info("games-played / variety badge — marks many titles as played (~1 min each)");
  const count = await ui.askNumber(
    `  ${CH.dim}how many titles${CH.reset} ${CH.dim}[100]:${CH.reset} `,
    100,
    { integer: true, min: 1 }
  );
  if (count === null) {
    fail("bad number");
    return await settle();
  }

  const picked = pickRotating(catalog, count);
  if (!picked.length) {
    fail("no titles");
    return await settle();
  }

  // ~1 minute per title (variety), hoursEach for journal ≈ 1/60
  await executeForge(picked, 1 / 60, "variety");
}

async function forgeAll(ctx) {
  if (!(await requireReady())) return;
  const s = vault.load();
  const { games: catalog } = ctx;

  const hours = await ui.askNumber(
    `  ${CH.dim}playtime hours per title${CH.reset} ${CH.dim}[${s.settings.hoursDefault}]:${CH.reset} `,
    s.settings.hoursDefault
  );
  if (hours === null) {
    fail("bad number");
    return await settle();
  }
  const playCount = await ui.askNumber(
    `  ${CH.dim}playtime titles${CH.reset} ${CH.dim}[30]:${CH.reset} `,
    30,
    { integer: true, min: 1 }
  );
  if (playCount === null) {
    fail("bad number");
    return await settle();
  }
  const streamHours = await ui.askNumber(
    `  ${CH.dim}stream hours total${CH.reset} ${CH.dim}[${hours}]:${CH.reset} `,
    hours
  );
  if (streamHours === null) {
    fail("bad number");
    return await settle();
  }
  const varietyCount = await ui.askNumber(
    `  ${CH.dim}variety titles${CH.reset} ${CH.dim}[50]:${CH.reset} `,
    50,
    { integer: true, min: 1 }
  );
  if (varietyCount === null) {
    fail("bad number");
    return await settle();
  }

  const playPicked = pickRotating(catalog, playCount);
  await executeForge(playPicked, hours, "playtime");

  const streamSessions = Math.min(12, Math.max(1, Math.ceil(streamHours)));
  const streamPicked = pickRotating(catalog, streamSessions);
  await executeForge(streamPicked, streamHours / streamSessions, "stream");

  const varietyPicked = pickRotating(catalog, varietyCount);
  await executeForge(varietyPicked, 1 / 60, "variety");
}

async function executeForge(picked, hoursEach, mode = "playtime") {
  const s = vault.load();
  blank();
  const per = mode === "variety" ? hoursEach : wobbleHours(hoursEach, s.settings.wobble);
  const ms = Math.max(1000, Math.floor(per * 3600 * 1000));

  const label =
    mode === "stream" ? "stream" : mode === "variety" ? "variety" : "playtime";
  info(
    `forging ${label} ${CH.orange}${fmt.hours(per)}${CH.reset} × ${CH.orange}${picked.length}${CH.reset}` +
      `${s.settings.dryRun ? ` ${CH.dim}${CH.yellow}(dry run)${CH.reset}` : ""}` +
      ` ${CH.dim}${BULLET}${CH.reset} ~${fmt.hours(per * picked.length)} total`
  );
  line();

  let buildEvents;
  if (mode === "stream") {
    buildEvents = (g) => science.buildStreamPair(g, ms);
  } else if (mode === "variety") {
    buildEvents = (g) => science.buildVarietySession(g);
  } else {
    buildEvents = (g) => science.buildSessionTriplet(g, ms);
  }

  const summary = await forge.runForges(picked, buildEvents, s.settings);

  blank();
  line();
  if (summary.failed === 0 && summary.ok > 0) {
    pass(
      `done ${CH.dim}${BULLET}${CH.reset} ${summary.ok}/${picked.length} ${label} ${CH.dim}${BULLET}${CH.reset} ${fmt.hours(summary.ok * per)} logged`
    );
    if (!s.settings.dryRun) info(QUIPS());
  } else if (summary.ok === 0) {
    fail("nothing was accepted");
  } else {
    warn(`partial ${CH.dim}${BULLET}${CH.reset} ${summary.ok} ok, ${summary.failed} refused`);
  }
  forge.recordRun(summary, per, s.settings.dryRun);
  if (!s.settings.dryRun) vault.rotateMemory(picked.map((g) => g.id));
  await settle();
}

async function bindFingerprint(ctx) {
  const s = vault.load();
  const uid = auth.userIdFromToken(s.token);
  if (!uid) {
    fail("set a valid token first");
    return await settle();
  }

  if (process.platform !== "win32") {
    info(`binding synthetic fingerprint for ${CH.orange}${process.platform}${CH.reset} (account ${uid})`);
    try {
      const fp = auth.syntheticFingerprint(uid);
      s.fingerprint = fp;
      vault.save();
      pass(`fingerprint bound ${CH.dim}${BULLET}${CH.reset} ${fp.length} chars (synthetic)`);
    } catch (e) {
      fail(String(e && e.message ? e.message : e));
    }
    return await settle();
  }

  info(`bind an executable_fingerprint to account ${CH.orange}${uid}${CH.reset}`);
  info("point it at any game .exe (or a running game's pid)");
  let target = await ui.ask(`  ${CH.dim}exe path or pid:${CH.reset} `);
  target = target.replace(/^"|"$/g, "");
  if (!target) {
    info("cancelled");
    return await settle();
  }

  const pid = /^\d+$/.test(target) ? parseInt(target, 10) : 0;
  if (!pid && !fs.existsSync(target)) {
    fail(`file not found: ${target}`);
    return await settle();
  }

  info("generating...");
  try {
    const fp = await auth.generateFingerprint(uid, pid ? "" : target, pid);
    s.fingerprint = fp;
    vault.save();
    pass(`fingerprint bound ${CH.dim}${BULLET}${CH.reset} ${fp.length} chars, stored in vault`);
  } catch (e) {
    fail(String(e && e.message ? e.message : e));
  }
  await settle();
}

async function probeStats(ctx) {
  const s = vault.load();
  if (!s.token) {
    fail("no token in vault");
    return await settle();
  }
  info("asking discord what it thinks...");
  try {
    const res = await fetch("https://discord.com/api/v9/users/@me", {
      headers: auth.buildHeaders(),
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const me = await res.json();
    blank();
    keyValue(
      "username",
      `${me.username}${me.discriminator && me.discriminator !== "0" ? `#${me.discriminator}` : ""}`
    );
    keyValue("user id", me.id);
    keyValue("locale", me.locale || "n/a");
    keyValue("verified", String(me.verified));
    if (me.premium_type) keyValue("nitro tier", String(me.premium_type));
    blank();
    info("local vault totals:");
    keyValue("titles forged (lifetime)", fmt.int(s.totals.titles));
    keyValue("hours forged (lifetime)", fmt.hours(s.totals.hours));
    keyValue("forge runs", fmt.int(s.totals.runs));
    if (s.lastRun)
      keyValue("last run", `${s.lastRun.ok} titles ${CH.dim}${CH.reset}\u00b7 ${fmt.ago(s.lastRun.at)}`);
    blank();
    info("badges: game-time (hours) · variety (5+ titles) · streaming (hours with viewers)");
  } catch (e) {
    fail(String(e && e.message ? e.message : e));
  }
  await settle();
}

async function renewSession(ctx) {
  const s = vault.load();
  if (await ui.confirm(`  ${CH.dim}paste a fresh cf_clearance cookie?`)) {
    const c = await ui.ask(`  ${CH.dim}cookie header:${CH.reset} `);
    if (c) {
      s.cookie = c;
      pass("cookie updated");
      envstore.sync({ cookie: c });
    } else info("cookie unchanged");
  }
  info("re-minting analytics token...");
  try {
    s.mintedAt = 0;
    vault.save();
    await session.renew();
    pass("session renewed");
  } catch (e) {
    fail(String(e && e.message ? e.message : e));
  }
  await settle();
}

async function catalogScan(ctx) {
  const { games: catalog } = ctx;
  const q = await ui.ask(`  ${CH.dim}search catalog:${CH.reset} `);
  const matches = games.searchGames(catalog, q);
  blank();
  if (!matches.length) {
    fail("no matches");
    return await settle();
  }
  info(`${matches.length} shown (cap 25)`);
  line();
  for (const g of matches) {
    const used = vault.load().recentIds.includes(g.id);
    const flag = used ? `${CH.green}forged${CH.reset}` : `${CH.dim}untouched${CH.reset}`;
    plain(`${CH.orange}${g.name.slice(0, 34).padEnd(34)}${CH.reset} ${CH.dim}<${g.id}>${CH.reset} ${flag}`);
  }
  line();
  await settle();
}

async function editSettings(ctx) {
  const s = vault.load();
  let done = false;
  while (!done) {
    blank();
    line();
    keyValue("batch size", `${s.settings.batchSize} titles/request`);
    keyValue("batch pause", `${s.settings.batchPauseMs} ms`);
    keyValue("wobble", s.settings.wobble ? "on (\u00b13% hour drift)" : "off");
    keyValue("dry run", s.settings.dryRun ? "ON (nothing is sent)" : "off");
    keyValue("default hours", String(s.settings.hoursDefault));
    line();
    plain(
      `${CH.orange}1${CH.reset} batch size   ${CH.orange}2${CH.reset} pause   ${CH.orange}3${CH.reset} wobble   ${CH.orange}4${CH.reset} dry run   ${CH.orange}5${CH.reset} default hours   ${CH.orange}enter${CH.reset} back`
    );
    const c = await ui.ask(`  ${CH.orange}\u276f${CH.reset} `);
    if (c === "1") {
      const v = await ui.askNumber(
        `  ${CH.dim}new batch size${CH.reset} ${CH.dim}[${s.settings.batchSize}]:${CH.reset} `,
        s.settings.batchSize,
        { integer: true, min: 1 }
      );
      if (v !== null) s.settings.batchSize = v;
    } else if (c === "2") {
      const v = await ui.askNumber(
        `  ${CH.dim}pause in ms${CH.reset} ${CH.dim}[${s.settings.batchPauseMs}]:${CH.reset} `,
        s.settings.batchPauseMs,
        { min: 0 }
      );
      if (v !== null) s.settings.batchPauseMs = v;
    } else if (c === "3") {
      s.settings.wobble = !s.settings.wobble;
    } else if (c === "4") {
      s.settings.dryRun = !s.settings.dryRun;
      warn(s.settings.dryRun ? "dry run ON - nothing will be sent" : "dry run off - live sending");
    } else if (c === "5") {
      const v = await ui.askNumber(
        `  ${CH.dim}default hours${CH.reset} ${CH.dim}[${s.settings.hoursDefault}]:${CH.reset} `,
        s.settings.hoursDefault,
        { min: 0 }
      );
      if (v !== null) s.settings.hoursDefault = v;
    } else {
      done = true;
    }
    vault.save();
  }
}

async function showJournal(ctx) {
  blank();
  line();
  let rows = [];
  try {
    if (fs.existsSync(PATHS.journal)) {
      rows = fs
        .readFileSync(PATHS.journal, "utf-8")
        .split("\n")
        .filter(Boolean)
        .slice(-LIMITS.journalTail)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);
    }
  } catch (_) {
    rows = [];
  }
  if (!rows.length) {
    info("journal is empty - run a forge first");
  } else {
    info(`last ${rows.length} runs`);
    line();
    for (const r of rows.reverse()) {
      const mode = r.mode === "dry" ? `${CH.yellow}dry${CH.reset}` : `${CH.green}live${CH.reset}`;
      plain(
        `${CH.dim}${fmt.ago(r.ts).padStart(9)}${CH.reset}  ${mode}  ${String(r.ok).padStart(4)} ok  ${String(r.failed).padStart(3)} fail  ${fmt.hours(r.totalHours)} `
      );
    }
  }
  line();
  await settle();
}

async function toolsSubmenu(ctx) {
  plain(`${CH.orange}a${CH.reset} probe stats   ${CH.orange}b${CH.reset} catalog scan   ${CH.orange}c${CH.reset} settings   ${CH.orange}d${CH.reset} journal   ${CH.orange}enter${CH.reset} back`);
  const c = (await ui.ask(`  ${CH.orange}\u276f${CH.reset} `)).toLowerCase();
  if (c === "a") await probeStats(ctx);
  else if (c === "b") await catalogScan(ctx);
  else if (c === "c") await editSettings(ctx);
  else if (c === "d") await showJournal(ctx);
}

function pickRotating(catalog, count) {
  const s = vault.load();
  const recent = new Set(s.recentIds);
  const fresh = catalog.filter((g) => !recent.has(g.id));
  const stale = catalog.filter((g) => recent.has(g.id));
  const pool = fresh.length >= count ? fresh : fresh.concat(stale);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

async function requireReady() {
  const s = vault.load();
  if (!s.token || !s.cookie) {
    fail("token/cookie missing - use menu 6 to set them");
    return false;
  }
  if (!vault.tokenFresh()) {
    info("analytics token stale, re-minting...");
    try {
      await session.renew();
    } catch (e) {
      fail(String(e && e.message ? e.message : e));
      return false;
    }
  }
  return true;
}

module.exports = {
  forgeBulk,
  forgeTitles,
  forgeStream,
  forgeVariety,
  forgeAll,
  bindFingerprint,
  probeStats,
  renewSession,
  catalogScan,
  editSettings,
  showJournal,
  toolsSubmenu,
  requireReady,
  pickRotating,
  executeForge,
};
