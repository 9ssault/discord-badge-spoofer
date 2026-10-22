"use strict";

/**
 * dispatch loop: chunks forged sessions into /science batches and records the
 * run into the journal.
 */

const fs = require("fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { ENDPOINTS, PATHS, CLIENT } = require("./config");
const vault = require("./vault");
const session = require("./session");
const { CH, info, warn, fail, BULLET } = require("./log");

function nextBatchPause(settings, index) {
  const base = settings.batchPauseMs;
  const jitter = Math.floor((Math.random() - 0.5) * base * 0.6);
  return Math.max(50, base + jitter + index * 2);
}

function journalAppend(entry) {
  try {
    fs.appendFileSync(PATHS.journal, JSON.stringify(entry) + "\n", "utf-8");
  } catch (_) {}
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

async function runForges(games, buildEventsFor, settings) {
  const total = games.length;
  const summary = { ok: 0, failed: 0, batches: 0, status: 0 };

  for (let i = 0; i < games.length; i += settings.batchSize) {
    summary.batches++;
    const chunk = games.slice(i, i + settings.batchSize);
    const events = [];
    for (const game of chunk) {
      for (const ev of buildEventsFor(game)) events.push(ev);
    }

    const status = await postScience(events, settings);

    if (status === 204) {
      summary.ok += chunk.length;
      info(`batch ${summary.batches} ${CH.dim}${BULLET}${CH.reset} ${summary.ok}/${total} forged`);
    } else if (status === 401 || status === 403) {
      fail(
        `batch ${summary.batches} ${CH.dim}${BULLET}${CH.reset} http ${status} auth rejected — renew session (menu 6)`
      );
      summary.failed += chunk.length;
      break;
    } else {
      summary.failed += chunk.length;
      warn(`batch ${summary.batches} ${CH.dim}${BULLET}${CH.reset} http ${status || "network error"}`);
    }

    if (i + settings.batchSize < games.length) {
      await sleep(nextBatchPause(settings, summary.batches));
    }
  }

  summary.status = summary.ok === total ? 204 : 0;
  return summary;
}

/**
 * Post a flat list of science events in large chunks (used by stream mode).
 * eventChunkSize = how many events per HTTP request (default 80 = 40 stream pairs).
 */
async function runEventBatches(events, settings, { eventChunkSize = 80, label = "events" } = {}) {
  const total = events.length;
  const summary = { ok: 0, failed: 0, batches: 0, status: 0, eventOk: 0 };
  const size = Math.max(2, eventChunkSize);

  for (let i = 0; i < events.length; i += size) {
    summary.batches++;
    const chunk = events.slice(i, i + size);
    const status = await postScience(chunk, settings);

    if (status === 204) {
      summary.eventOk += chunk.length;
      summary.ok += 1;
      info(
        `batch ${summary.batches} ${CH.dim}${BULLET}${CH.reset} ${summary.eventOk}/${total} ${label} accepted`
      );
    } else if (status === 401 || status === 403) {
      fail(`batch ${summary.batches} ${CH.dim}${BULLET}${CH.reset} http ${status} auth rejected — renew session (menu 6)`);
      summary.failed += 1;
      break;
    } else {
      summary.failed += 1;
      warn(`batch ${summary.batches} ${CH.dim}${BULLET}${CH.reset} http ${status || "network error"}`);
    }

    if (i + size < events.length) {
      await sleep(nextBatchPause(settings, summary.batches));
    }
  }

  summary.status = summary.failed === 0 && summary.eventOk > 0 ? 204 : 0;
  return summary;
}

function recordRun(summary, hoursEach, dry, extra = {}) {
  const state = vault.load();
  if (!dry) {
    state.totals.titles += summary.ok || summary.eventOk || 0;
    state.totals.hours += (summary.ok || 0) * hoursEach;
    if (extra.totalHours) state.totals.hours += extra.totalHours;
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
  });
}

module.exports = { runForges, runEventBatches, recordRun, journalAppend, postScience };
