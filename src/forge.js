"use strict";

const fs = require("fs");
const path = require("path");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { ENDPOINTS, PATHS, CLIENT, LIMITS } = require("./config");
const vault = require("./vault");
const session = require("./session");
const checkpoint = require("./checkpoint");
const { CH, info, warn, fail, BULLET } = require("./log");

function nextBatchPause(settings, index) {
  const base = settings.batchPauseMs || 300;
  const jitter = Math.floor((Math.random() - 0.5) * base * 0.6);
  return Math.max(50, base + jitter + index * 2);
}

function journalAppend(entry) {
  try {
    fs.appendFileSync(PATHS.journal, JSON.stringify(entry) + "\n", "utf-8");
  } catch (_) {}
}

function progressLine(done, total, startedAt, label) {
  const pct = total ? Math.min(100, Math.floor((done / total) * 100)) : 0;
  const width = 20;
  const filled = Math.floor((pct / 100) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const elapsed = (Date.now() - startedAt) / 1000;
  const rate = done > 0 ? elapsed / done : 0;
  const eta = rate * (total - done);
  const etaStr = eta > 60 ? `${Math.ceil(eta / 60)}m` : `${Math.ceil(eta)}s`;
  process.stdout.write(
    `\r  ${CH.dim}${bar}${CH.reset} ${pct}% ${done}/${total} ${label || ""} ETA ${etaStr}   `
  );
  if (done >= total) process.stdout.write("\n");
}

function dumpDebug(events, status) {
  try {
    fs.mkdirSync(PATHS.debugDir, { recursive: true });
    const name = path.join(PATHS.debugDir, `science-${Date.now()}-${status}.json`);
    fs.writeFileSync(
      name,
      JSON.stringify({ status, at: new Date().toISOString(), count: events.length, events }, null, 2),
      "utf-8"
    );
    return name;
  } catch (_) {
    return null;
  }
}

async function postScience(events, settings) {
  const state = vault.load();
  if (settings.dryRun) return 204;
  try {
    const res = await fetch(ENDPOINTS.science, {
      method: "POST",
      headers: {
        accept: "*/*",
        "accept-language": CLIENT.locale,
        authorization: state.token,
        "content-type": "application/json",
        cookie: state.cookie,
        origin: "https://discord.com",
        referer: "https://discord.com/channels/@me",
        "user-agent": CLIENT.agent,
        "x-debug-options": "bugReporterEnabled",
        "x-discord-locale": CLIENT.locale,
        "x-discord-timezone": CLIENT.timezone,
        "x-super-properties": session.superProps || session.getSuperProps(),
      },
      body: JSON.stringify({ token: state.analyticsToken, events }),
    });
    return res.status;
  } catch (_) {
    return 0;
  }
}

async function postWithRetry(events, settings) {
  const max = settings.maxRetries != null ? settings.maxRetries : LIMITS.maxRetries;
  let status = 0;
  for (let attempt = 0; attempt <= max; attempt++) {
    status = await postScience(events, settings);
    if (status === 204) return status;
    if (status === 401 || status === 403) return status;
    if (attempt < max) {
      const wait = LIMITS.retryBaseMs * Math.pow(2, attempt);
      warn(`retry ${attempt + 1}/${max} after ${wait}ms (http ${status || "net"})`);
      await sleep(wait);
    }
  }
  if (settings.debugDump || status !== 204) {
    const f = dumpDebug(events, status);
    if (f) info(`debug dump ${CH.dim}${BULLET}${CH.reset} ${f}`);
  }
  return status;
}

async function runForges(games, buildEventsFor, settings, { resumeFrom = 0, mode = "playtime" } = {}) {
  const total = games.length;
  const summary = { ok: 0, failed: 0, batches: 0, status: 0, skipped: resumeFrom };
  const startedAt = Date.now();

  for (let i = resumeFrom; i < games.length; i += settings.batchSize) {
    summary.batches++;
    const chunk = games.slice(i, i + settings.batchSize);
    const events = [];
    for (const game of chunk) {
      for (const ev of buildEventsFor(game)) events.push(ev);
    }

    const status = await postWithRetry(events, settings);

    if (status === 204) {
      summary.ok += chunk.length;
      progressLine(summary.ok + resumeFrom, total, startedAt, mode);
      checkpoint.save({
        mode,
        index: i + chunk.length,
        total,
        gameIds: games.map((g) => g.id),
        at: new Date().toISOString(),
      });
    } else if (status === 401 || status === 403) {
      fail(`batch ${summary.batches} http ${status} auth rejected — renew session (menu 6)`);
      summary.failed += chunk.length;
      break;
    } else {
      summary.failed += chunk.length;
      warn(`batch ${summary.batches} http ${status || "network error"}`);
    }

    if (i + settings.batchSize < games.length) {
      let pause = nextBatchPause(settings, summary.batches);
      if (settings.pace === "drip") {
        pause = Math.max(pause, settings.dripPauseMs || 15 * 60 * 1000);
        info(`drip pause ${Math.round(pause / 1000)}s…`);
      }
      await sleep(pause);
    }
  }

  if (summary.failed === 0) checkpoint.clear();
  summary.status = summary.ok + resumeFrom >= total && summary.failed === 0 ? 204 : 0;
  return summary;
}

async function runEventBatches(events, settings, { eventChunkSize = 80, label = "events", resumeFrom = 0 } = {}) {
  const total = events.length;
  const summary = { ok: 0, failed: 0, batches: 0, status: 0, eventOk: 0 };
  const size = Math.max(2, eventChunkSize);
  const startedAt = Date.now();

  for (let i = resumeFrom; i < events.length; i += size) {
    summary.batches++;
    const chunk = events.slice(i, i + size);
    const status = await postWithRetry(chunk, settings);

    if (status === 204) {
      summary.eventOk += chunk.length;
      summary.ok += 1;
      progressLine(summary.eventOk + resumeFrom, total, startedAt, label);
      checkpoint.save({
        mode: label,
        index: i + chunk.length,
        total,
        at: new Date().toISOString(),
      });
    } else if (status === 401 || status === 403) {
      fail(`batch ${summary.batches} http ${status} auth rejected`);
      summary.failed += 1;
      break;
    } else {
      summary.failed += 1;
      warn(`batch ${summary.batches} http ${status || "network error"}`);
    }

    if (i + size < events.length) {
      let pause = nextBatchPause(settings, summary.batches);
      if (settings.pace === "drip") {
        pause = Math.max(pause, settings.dripPauseMs || 15 * 60 * 1000);
        info(`drip pause ${Math.round(pause / 1000)}s…`);
      }
      await sleep(pause);
    }
  }

  if (summary.failed === 0) checkpoint.clear();
  summary.status = summary.failed === 0 && summary.eventOk > 0 ? 204 : 0;
  return summary;
}

function recordRun(summary, hoursEach, dry, extra = {}) {
  const state = vault.load();
  if (!dry) {
    const okUnits = summary.ok || 0;
    state.totals.titles += okUnits;
    if (extra.mode === "stream") {
      state.totals.streamHours = (state.totals.streamHours || 0) + (extra.totalHours || 0);
    } else if (extra.mode === "variety") {
      state.totals.varietyTitles = (state.totals.varietyTitles || 0) + okUnits;
    } else {
      state.totals.hours += okUnits * hoursEach;
    }
    if (extra.totalHours && extra.mode !== "stream") state.totals.hours += extra.totalHours;
    state.totals.runs += 1;
    state.lastRun = {
      at: new Date().toISOString(),
      ok: summary.ok,
      failed: summary.failed,
      hoursEach,
      ...extra,
    };
    vault.save();
  }
  journalAppend({
    ts: new Date().toISOString(),
    mode: dry ? "dry" : extra.mode || "live",
    ok: summary.ok,
    failed: summary.failed,
    batches: summary.batches,
    hoursEach,
    totalHours: extra.totalHours != null ? extra.totalHours : summary.ok * hoursEach,
    eventOk: summary.eventOk || 0,
    profile: vault.load().activeProfile,
  });
}

function journalStats() {
  let rows = [];
  try {
    if (fs.existsSync(PATHS.journal)) {
      rows = fs
        .readFileSync(PATHS.journal, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);
    }
  } catch (_) {}
  const byMode = {};
  let ok = 0;
  let fail = 0;
  let hours = 0;
  for (const r of rows) {
    const m = r.mode || "?";
    byMode[m] = byMode[m] || { runs: 0, ok: 0, fail: 0, hours: 0 };
    byMode[m].runs++;
    byMode[m].ok += r.ok || 0;
    byMode[m].fail += r.failed || 0;
    byMode[m].hours += r.totalHours || 0;
    ok += r.ok || 0;
    fail += r.failed || 0;
    hours += r.totalHours || 0;
  }
  return { rows, byMode, ok, fail, hours, total: rows.length };
}

module.exports = {
  runForges,
  runEventBatches,
  recordRun,
  journalAppend,
  postScience,
  postWithRetry,
  progressLine,
  journalStats,
  dumpDebug,
};
