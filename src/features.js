"use strict";

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
const badges = require("./badges");
const checkpoint = require("./checkpoint");

const QUIPS = () => ORCA.quips[Math.floor(Math.random() * ORCA.quips.length)];

function wobbleHours(h, enabled) {
  if (!enabled) return h;
  return Math.max(0.01, h * (1 + (Math.random() * 0.06 - 0.03)));
}

async function settle() {
  const { pause } = require("./log");
  await pause();
}

function filteredCatalog(catalog) {
  const s = vault.load();
  return games.applyFilter(catalog, s.settings.catalogFilter);
}

async function forgeBulk(ctx) {
  if (!(await requireReady())) return;
  const catalog = filteredCatalog(ctx.games);
  const s = vault.load();
  blank();
  ui.section("PLAYTIME FORGE");
  info(`catalog ${CH.orange}${catalog.length}${CH.reset} titles · filter=${s.settings.catalogFilter} · pace=${s.settings.pace}`);
  const count = await ui.askNumber(`  ${CH.dim}titles this run${CH.reset} ${CH.dim}[all]:${CH.reset} `, catalog.length, {
    integer: true,
    min: 1,
  });
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
  if (!(await requireReady())) return;
  const catalog = filteredCatalog(ctx.games);
  const s = vault.load();
  blank();
  ui.section("FORGE ON TITLES");
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
  if (!(await requireReady())) return;
  const catalog = filteredCatalog(ctx.games);
  blank();
  ui.section("STREAM FORGE");
  info("pure science · video_stream_started / ended");
  info(`${CH.dim}Discord may still require a real viewer for the badge${CH.reset}`);
  const hoursIn = await ui.askNumber(`  ${CH.dim}total stream hours${CH.reset} ${CH.dim}[50]:${CH.reset} `, 50, {
    min: 0.1,
  });
  if (hoursIn === null) {
    fail("bad number");
    return await settle();
  }
  const defaultSessions = Math.min(100, Math.max(1, Math.ceil(hoursIn / 10)));
  const sessions = await ui.askNumber(
    `  ${CH.dim}sessions (~10h each default)${CH.reset} ${CH.dim}[${defaultSessions}]:${CH.reset} `,
    defaultSessions,
    { integer: true, min: 1 }
  );
  if (sessions === null) {
    fail("bad number");
    return await settle();
  }
  const picked = pickRotating(catalog, sessions);
  if (!picked.length) {
    fail("no titles");
    return await settle();
  }
  await executeStreamForge(picked, hoursIn, sessions);
}

async function executeStreamForge(picked, totalHours, sessions) {
  const s = vault.load();
  blank();
  const built = science.buildStreamBatch(picked, totalHours, sessions);
  const events = built.events;
  info(
    `forging stream ${CH.orange}${fmt.hours(totalHours)}${CH.reset} × ${CH.orange}${built.sessions}${CH.reset} sessions` +
      ` ${CH.dim}(~${fmt.hours(built.hoursEach)} each · pace=${s.settings.pace})${CH.reset}` +
      `${s.settings.dryRun ? ` ${CH.yellow}(dry)${CH.reset}` : ""}`
  );
  line();
  const cp = checkpoint.load();
  const resumeFrom = cp && cp.mode === "stream events" ? cp.index || 0 : 0;
  if (resumeFrom > 0) info(`resuming from event ${resumeFrom}`);
  const summary = await forge.runEventBatches(events, s.settings, {
    eventChunkSize: 80,
    label: "stream events",
    resumeFrom,
  });
  blank();
  line();
  if (summary.failed === 0 && summary.eventOk > 0) {
    pass(`done ${summary.eventOk}/${events.length} events · ${fmt.hours(totalHours)} claimed`);
    if (!s.settings.dryRun) info(QUIPS());
  } else if (summary.eventOk === 0) fail("nothing was accepted");
  else warn(`partial · ${summary.eventOk} events ok`);
  forge.recordRun(summary, built.hoursEach, s.settings.dryRun, {
    mode: "stream",
    totalHours,
    sessions: built.sessions,
  });
  if (!s.settings.dryRun) vault.rotateMemory(picked.map((g) => g.id));
  await settle();
}

async function forgeVariety(ctx) {
  if (!(await requireReady())) return;
  const catalog = filteredCatalog(ctx.games);
  blank();
  ui.section("VARIETY FORGE");
  info("marks many titles as played (~1 min each)");
  const count = await ui.askNumber(`  ${CH.dim}how many titles${CH.reset} ${CH.dim}[100]:${CH.reset} `, 100, {
    integer: true,
    min: 1,
  });
  if (count === null) {
    fail("bad number");
    return await settle();
  }
  const picked = pickRotating(catalog, count);
  if (!picked.length) {
    fail("no titles");
    return await settle();
  }
  await executeForge(picked, 1 / 60, "variety");
}

async function forgeAll(ctx) {
  if (!(await requireReady())) return;
  const s = vault.load();
  const catalog = filteredCatalog(ctx.games);
  blank();
  ui.section("ALL BADGES");
  const hours = await ui.askNumber(
    `  ${CH.dim}playtime hours/title${CH.reset} ${CH.dim}[${s.settings.hoursDefault}]:${CH.reset} `,
    s.settings.hoursDefault
  );
  if (hours === null) return await settle();
  const playCount = await ui.askNumber(`  ${CH.dim}playtime titles${CH.reset} ${CH.dim}[30]:${CH.reset} `, 30, {
    integer: true,
    min: 1,
  });
  if (playCount === null) return await settle();
  const streamHours = await ui.askNumber(`  ${CH.dim}stream hours${CH.reset} ${CH.dim}[50]:${CH.reset} `, 50, {
    min: 0.1,
  });
  if (streamHours === null) return await settle();
  const varietyCount = await ui.askNumber(`  ${CH.dim}variety titles${CH.reset} ${CH.dim}[50]:${CH.reset} `, 50, {
    integer: true,
    min: 1,
  });
  if (varietyCount === null) return await settle();
  await executeForge(pickRotating(catalog, playCount), hours, "playtime");
  const ss = Math.min(100, Math.max(1, Math.ceil(streamHours / 10)));
  await executeStreamForge(pickRotating(catalog, ss), streamHours, ss);
  await executeForge(pickRotating(catalog, varietyCount), 1 / 60, "variety");
}

async function executeForge(picked, hoursEach, mode = "playtime") {
  const s = vault.load();
  blank();
  const per = mode === "variety" ? hoursEach : wobbleHours(hoursEach, s.settings.wobble);
  const ms = Math.max(1000, Math.floor(per * 3600 * 1000));
  const label = mode === "variety" ? "variety" : "playtime";
  info(
    `forging ${label} ${CH.orange}${fmt.hours(per)}${CH.reset} × ${CH.orange}${picked.length}${CH.reset}` +
      `${s.settings.dryRun ? ` ${CH.yellow}(dry)${CH.reset}` : ""}` +
      ` ${CH.dim}pace=${s.settings.pace}${CH.reset}` +
      ` · ~${fmt.hours(per * picked.length)} total`
  );
  line();
  const buildEvents =
    mode === "variety"
      ? (g) => science.buildVarietySession(g)
      : (g) => science.buildSessionTriplet(g, ms);
  const cp = checkpoint.load();
  let resumeFrom = 0;
  if (cp && cp.mode === mode && Array.isArray(cp.gameIds)) {
    resumeFrom = cp.index || 0;
    if (resumeFrom > 0) info(`resuming ${mode} from index ${resumeFrom}`);
  }
  const summary = await forge.runForges(picked, buildEvents, s.settings, { resumeFrom, mode });
  blank();
  line();
  if (summary.failed === 0 && summary.ok > 0) {
    pass(`done ${summary.ok}/${picked.length} ${label} · ${fmt.hours(summary.ok * per)} logged`);
    if (!s.settings.dryRun) info(QUIPS());
  } else if (summary.ok === 0) fail("nothing was accepted");
  else warn(`partial · ${summary.ok} ok, ${summary.failed} refused`);
  forge.recordRun(summary, per, s.settings.dryRun, { mode });
  if (!s.settings.dryRun) vault.rotateMemory(picked.map((g) => g.id));
  await settle();
}

async function showLadder(ctx) {
  const s = vault.load();
  blank();
  ui.section("BADGE LADDER");
  plain(`${CH.white}Game time${CH.reset}  ${CH.dim}(vault ${fmt.hours(s.totals.hours)})${CH.reset}`);
  for (const t of badges.GAME_TIME) {
    const hit = s.totals.hours >= t.hours;
    plain(`  ${hit ? CH.green + "✓" : CH.dim + "·"}${CH.reset} ${String(t.hours).padStart(5)}h  ${t.name}`);
  }
  const ng = badges.nextTier(badges.GAME_TIME, s.totals.hours, "hours");
  if (ng) info(`next → ${ng.name} (+${fmt.hours(ng.hours - s.totals.hours)})`);
  else pass("max game-time tier");
  blank();
  plain(`${CH.white}Streaming${CH.reset}  ${CH.dim}(vault ${fmt.hours(s.totals.streamHours || 0)})${CH.reset}`);
  for (const t of badges.STREAM) {
    const hit = (s.totals.streamHours || 0) >= t.hours;
    plain(`  ${hit ? CH.green + "✓" : CH.dim + "·"}${CH.reset} ${String(t.hours).padStart(5)}h  ${t.name}`);
  }
  const ns = badges.nextTier(badges.STREAM, s.totals.streamHours || 0, "hours");
  if (ns) info(`next → ${ns.name} (+${fmt.hours(ns.hours - (s.totals.streamHours || 0))})`);
  else pass("max stream tier");
  blank();
  plain(`${CH.white}Variety${CH.reset}  ${CH.dim}(vault ${fmt.int(s.totals.varietyTitles || 0)} titles)${CH.reset}`);
  for (const t of badges.VARIETY) {
    const hit = (s.totals.varietyTitles || 0) >= t.titles;
    plain(`  ${hit ? CH.green + "✓" : CH.dim + "·"}${CH.reset} ${String(t.titles).padStart(4)}  ${t.name}`);
  }
  const nv = badges.nextTier(badges.VARIETY, s.totals.varietyTitles || 0, "titles");
  if (nv) info(`next → ${nv.name} (+${nv.titles - (s.totals.varietyTitles || 0)} titles)`);
  else pass("max variety tier");
  line();
  info("vault totals are local estimates — Discord may lag or differ");
  plain(`${CH.dim}menu 6 = forge the gap to the next tier automatically${CH.reset}`);
  await settle();
}

async function forgeToNextTier(ctx) {
  if (!(await requireReady())) return;
  const s = vault.load();
  const catalog = filteredCatalog(ctx.games);
  blank();
  ui.section("FORGE TO NEXT TIER");
  plain(`${CH.orange}1${CH.reset} game-time next`);
  plain(`${CH.orange}2${CH.reset} stream next`);
  plain(`${CH.orange}3${CH.reset} variety next`);
  const c = await ui.ask(`  ${CH.orange}❯${CH.reset} `);
  if (c === "1") {
    const next = badges.nextTier(badges.GAME_TIME, s.totals.hours, "hours");
    if (!next) {
      pass("already max game-time tier");
      return await settle();
    }
    const need = next.hours - s.totals.hours;
    info(`need ${fmt.hours(need)} more for ${next.name}`);
    const titles = Math.min(50, Math.max(5, Math.ceil(need / Math.max(1, s.settings.hoursDefault))));
    const per = need / titles;
    await executeForge(pickRotating(catalog, titles), per, "playtime");
  } else if (c === "2") {
    const next = badges.nextTier(badges.STREAM, s.totals.streamHours || 0, "hours");
    if (!next) {
      pass("already max stream tier");
      return await settle();
    }
    const need = next.hours - (s.totals.streamHours || 0);
    info(`need ${fmt.hours(need)} more for ${next.name}`);
    const sessions = Math.min(100, Math.max(1, Math.ceil(need / 10)));
    await executeStreamForge(pickRotating(catalog, sessions), need, sessions);
  } else if (c === "3") {
    const next = badges.nextTier(badges.VARIETY, s.totals.varietyTitles || 0, "titles");
    if (!next) {
      pass("already max variety tier");
      return await settle();
    }
    const need = next.titles - (s.totals.varietyTitles || 0);
    info(`need ${need} more titles for ${next.name}`);
    await executeForge(pickRotating(catalog, need), 1 / 60, "variety");
  }
}

async function profilesMenu(ctx) {
  blank();
  ui.section("PROFILES");
  const list = vault.listProfiles();
  const s = vault.load();
  info(`active: ${CH.orange}${s.activeProfile}${CH.reset}`);
  plain(`available: ${list.join(", ") || "(none yet)"}`);
  blank();
  plain(`${CH.orange}1${CH.reset} switch profile`);
  plain(`${CH.orange}2${CH.reset} save current as…`);
  plain(`${CH.orange}3${CH.reset} export vault`);
  plain(`${CH.orange}4${CH.reset} import vault`);
  plain(`${CH.dim}enter${CH.reset} back`);
  const c = await ui.ask(`  ${CH.orange}❯${CH.reset} `);
  if (c === "1") {
    const name = await ui.ask(`  ${CH.dim}profile name:${CH.reset} `);
    if (name) {
      vault.switchProfile(name);
      pass(`switched to ${name}`);
      try {
        await session.begin();
        if (!vault.tokenFresh()) await session.renew();
      } catch (e) {
        warn(String(e.message || e));
      }
    }
  } else if (c === "2") {
    const name = await ui.ask(`  ${CH.dim}save as:${CH.reset} `);
    if (name) {
      vault.saveProfile(name);
      pass(`saved profile ${name}`);
    }
  } else if (c === "3") {
    const redact = await ui.confirm(`  ${CH.dim}redact secrets?`);
    const data = vault.exportVault({ redact });
    const out = PATHS.vault.replace("vault.json", `vault-export-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(data, null, 2));
    pass(`exported → ${out}`);
  } else if (c === "4") {
    const p = await ui.ask(`  ${CH.dim}path to json:${CH.reset} `);
    if (p && fs.existsSync(p)) {
      try {
        vault.importVault(JSON.parse(fs.readFileSync(p, "utf-8")));
        pass("imported");
      } catch (e) {
        fail(String(e.message || e));
      }
    } else fail("file not found");
  }
  await settle();
}

async function resumeCheckpoint(ctx) {
  blank();
  ui.section("CHECKPOINT");
  const cp = checkpoint.load();
  if (!cp) {
    info("no checkpoint — forges write one on interrupt / mid-run");
    return await settle();
  }
  keyValue("mode", String(cp.mode));
  keyValue("index", `${cp.index}/${cp.total}`);
  keyValue("at", String(cp.at));
  blank();
  plain(`${CH.dim}Re-run the same forge mode to auto-resume.${CH.reset}`);
  if (await ui.confirm(`  ${CH.dim}clear checkpoint?`)) {
    checkpoint.clear();
    pass("checkpoint cleared");
  }
  await settle();
}

async function bindFingerprint(ctx) {
  const s = vault.load();
  const uid = auth.userIdFromToken(s.token);
  if (!uid) {
    fail("set a valid token first");
    return await settle();
  }
  blank();
  ui.section("FINGERPRINT");
  if (process.platform !== "win32") {
    try {
      const fp = auth.syntheticFingerprint(uid);
      s.fingerprint = fp;
      vault.save();
      pass(`synthetic fingerprint · ${fp.length} chars (${process.platform})`);
    } catch (e) {
      fail(String(e.message || e));
    }
    return await settle();
  }
  let target = await ui.ask(`  ${CH.dim}exe path or pid:${CH.reset} `);
  target = target.replace(/^"|"$/g, "");
  if (!target) return await settle();
  const pid = /^\d+$/.test(target) ? parseInt(target, 10) : 0;
  if (!pid && !fs.existsSync(target)) {
    fail(`file not found: ${target}`);
    return await settle();
  }
  try {
    const fp = await auth.generateFingerprint(uid, pid ? "" : target, pid);
    s.fingerprint = fp;
    vault.save();
    pass(`fingerprint bound · ${fp.length} chars`);
  } catch (e) {
    fail(String(e.message || e));
  }
  await settle();
}

async function probeStats(ctx) {
  const s = vault.load();
  if (!s.token) {
    fail("no token");
    return await settle();
  }
  blank();
  ui.section("PROBE");
  try {
    const res = await fetch("https://discord.com/api/v9/users/@me", { headers: auth.buildHeaders() });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const me = await res.json();
    keyValue("profile", s.activeProfile);
    keyValue("username", me.username);
    keyValue("user id", me.id);
    keyValue("playtime (vault)", fmt.hours(s.totals.hours));
    keyValue("stream (vault)", fmt.hours(s.totals.streamHours || 0));
    keyValue("variety (vault)", fmt.int(s.totals.varietyTitles || 0));
    keyValue("runs", fmt.int(s.totals.runs));
    keyValue("pace", s.settings.pace);
    keyValue("filter", s.settings.catalogFilter);
    keyValue("dry run", s.settings.dryRun ? "ON" : "off");
  } catch (e) {
    fail(String(e.message || e));
  }
  await settle();
}

async function renewSession(ctx) {
  blank();
  ui.section("RENEW SESSION");
  const s = vault.load();
  if (await ui.confirm(`  ${CH.dim}paste a fresh cf_clearance cookie?`)) {
    const c = await ui.ask(`  ${CH.dim}cookie header:${CH.reset} `);
    if (c) {
      s.cookie = c;
      vault.save();
      envstore.sync({ cookie: c });
      pass("cookie updated");
    }
  }
  try {
    s.mintedAt = 0;
    vault.save();
    await session.renew();
    pass("session renewed");
  } catch (e) {
    fail(String(e.message || e));
  }
  await settle();
}

async function catalogScan(ctx) {
  blank();
  ui.section("CATALOG");
  const catalog = filteredCatalog(ctx.games);
  info(`${catalog.length} titles after filter=${vault.load().settings.catalogFilter}`);
  const q = await ui.ask(`  ${CH.dim}search:${CH.reset} `);
  const matches = games.searchGames(catalog, q);
  if (!matches.length) {
    fail("no matches");
    return await settle();
  }
  line();
  for (const g of matches) {
    const used = vault.load().recentIds.includes(g.id);
    plain(
      `${CH.orange}${g.name.slice(0, 34).padEnd(34)}${CH.reset} ${CH.dim}<${g.id}>${CH.reset} ${used ? CH.green + "forged" : CH.dim + "untouched"}${CH.reset}`
    );
  }
  line();
  await settle();
}

async function editSettings(ctx) {
  const s = vault.load();
  let done = false;
  while (!done) {
    blank();
    ui.section("SETTINGS");
    keyValue("batch size", String(s.settings.batchSize));
    keyValue("batch pause", `${s.settings.batchPauseMs} ms`);
    keyValue("wobble", s.settings.wobble ? "on (±3%)" : "off");
    keyValue("dry run", s.settings.dryRun ? "ON" : "off");
    keyValue("default hours", String(s.settings.hoursDefault));
    keyValue("pace", s.settings.pace);
    keyValue("drip pause", `${Math.round((s.settings.dripPauseMs || 0) / 1000)}s`);
    keyValue("catalog filter", s.settings.catalogFilter);
    keyValue("max retries", String(s.settings.maxRetries));
    keyValue("debug dump", s.settings.debugDump ? "on" : "off");
    line();
    plain(`${CH.orange}1${CH.reset} batch size   ${CH.orange}2${CH.reset} pause ms   ${CH.orange}3${CH.reset} wobble   ${CH.orange}4${CH.reset} dry run   ${CH.orange}5${CH.reset} hours`);
    plain(`${CH.orange}6${CH.reset} pace toggle  ${CH.orange}7${CH.reset} filter   ${CH.orange}8${CH.reset} retries  ${CH.orange}9${CH.reset} debug    ${CH.dim}enter${CH.reset} back`);
    const c = await ui.ask(`  ${CH.orange}❯${CH.reset} `);
    if (c === "1") {
      const v = await ui.askNumber(`  batch size [${s.settings.batchSize}]: `, s.settings.batchSize, {
        integer: true,
        min: 1,
      });
      if (v !== null) s.settings.batchSize = v;
    } else if (c === "2") {
      const v = await ui.askNumber(`  pause ms [${s.settings.batchPauseMs}]: `, s.settings.batchPauseMs, {
        min: 0,
      });
      if (v !== null) s.settings.batchPauseMs = v;
    } else if (c === "3") s.settings.wobble = !s.settings.wobble;
    else if (c === "4") {
      s.settings.dryRun = !s.settings.dryRun;
      warn(s.settings.dryRun ? "dry run ON" : "dry run off");
    } else if (c === "5") {
      const v = await ui.askNumber(`  default hours [${s.settings.hoursDefault}]: `, s.settings.hoursDefault, {
        min: 0,
      });
      if (v !== null) s.settings.hoursDefault = v;
    } else if (c === "6") {
      s.settings.pace = s.settings.pace === "drip" ? "aggressive" : "drip";
      info(`pace → ${s.settings.pace}`);
    } else if (c === "7") {
      plain(`${CH.dim}all | verified | steam | no-launcher${CH.reset}`);
      const f = await ui.ask(`  filter [${s.settings.catalogFilter}]: `);
      if (f) s.settings.catalogFilter = f.toLowerCase();
    } else if (c === "8") {
      const v = await ui.askNumber(`  max retries [${s.settings.maxRetries}]: `, s.settings.maxRetries, {
        integer: true,
        min: 0,
      });
      if (v !== null) s.settings.maxRetries = v;
    } else if (c === "9") s.settings.debugDump = !s.settings.debugDump;
    else done = true;
    vault.save();
  }
}

async function showJournal(ctx) {
  blank();
  ui.section("JOURNAL");
  const stats = forge.journalStats();
  if (!stats.total) {
    info("journal empty — run a forge first");
  } else {
    info(`${stats.total} runs · ${fmt.hours(stats.hours)} claimed · ok=${stats.ok} fail=${stats.fail}`);
    for (const [m, v] of Object.entries(stats.byMode)) {
      plain(`  ${m.padEnd(12)} runs=${v.runs} ok=${v.ok} fail=${v.fail} hours=${fmt.hours(v.hours)}`);
    }
    line();
    for (const r of stats.rows.slice(-LIMITS.journalTail).reverse()) {
      plain(
        `${CH.dim}${fmt.ago(r.ts).padStart(9)}${CH.reset}  ${(r.mode || "?").padEnd(8)}  ok=${r.ok} fail=${r.failed}  ${fmt.hours(r.totalHours || 0)}`
      );
    }
  }
  line();
  await settle();
}

async function toolsSubmenu(ctx) {
  blank();
  ui.section("TOOLS");
  plain(`${CH.orange}a${CH.reset}  probe stats          account + vault totals`);
  plain(`${CH.orange}b${CH.reset}  catalog scan         search detectables`);
  plain(`${CH.orange}c${CH.reset}  settings             batch · pace · filter · dry`);
  plain(`${CH.orange}d${CH.reset}  journal              run history + rates`);
  plain(`${CH.orange}e${CH.reset}  badge ladder         tiers + next gap`);
  plain(`${CH.orange}f${CH.reset}  profiles             multi-account · export`);
  plain(`${CH.orange}g${CH.reset}  checkpoint          resume / clear`);
  plain(`${CH.dim}enter${CH.reset} back`);
  const c = (await ui.ask(`  ${CH.orange}❯${CH.reset} `)).toLowerCase();
  if (c === "a") await probeStats(ctx);
  else if (c === "b") await catalogScan(ctx);
  else if (c === "c") await editSettings(ctx);
  else if (c === "d") await showJournal(ctx);
  else if (c === "e") await showLadder(ctx);
  else if (c === "f") await profilesMenu(ctx);
  else if (c === "g") await resumeCheckpoint(ctx);
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
    fail("token/cookie missing — menu 8 or profiles");
    return false;
  }
  if (!vault.tokenFresh()) {
    info("analytics token stale, re-minting…");
    try {
      await session.renew();
    } catch (e) {
      fail(String(e.message || e));
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
  forgeToNextTier,
  showLadder,
  profilesMenu,
  resumeCheckpoint,
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
  executeStreamForge,
  filteredCatalog,
};
