"use strict";

/**
 * dispatch loop: chunks forged sessions into /science batches and records the
 * run into the journal. Supports dual-token stream posts (host + viewer).
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

function scienceHeaders(token, cookie, superProps) {
  return {
    accept: "*/*",
    "accept-language": CLIENT.locale,
    authorization: token,
    "content-type": "application/json",
    cookie: cookie || "",
    origin: "https://discord.com",
    referer: "https://discord.com/channels/@me",
    "user-agent": CLIENT.agent,
    "x-debug-options": "bugReporterEnabled",
    "x-discord-locale": CLIENT.locale,
    "x-discord-timezone": CLIENT.timezone,
    "x-super-properties": superProps || session.superProps || session.getSuperProps(),
  };
}

async function postScience(token, cookie, analyticsToken, events, superProps, dryRun) {
  if (dryRun) return 204;
  try {
    const res = await fetch(ENDPOINTS.science, {
      method: "POST",
      headers: scienceHeaders(token, cookie, superProps),
      body: JSON.stringify({ token: analyticsToken, events }),
    });
    return res.status;
  } catch (_) {
    return 0;
  }
}

async function runForges(games, buildEventsFor, settings) {
  const state = vault.load();
  const total = games.length;
  const summary = { ok: 0, failed: 0, batches: 0, status: 0, viewerOk: 0 };

  for (let i = 0; i < games.length; i += settings.batchSize) {
    summary.batches++;
    const chunk = games.slice(i, i + settings.batchSize);
    const events = [];
    for (const game of chunk) {
      const built = buildEventsFor(game);
      // buildEventsFor may return array or { events, viewerEvents }
      if (Array.isArray(built)) {
        for (const ev of built) events.push(ev);
      } else if (built && built.events) {
        for (const ev of built.events) events.push(ev);
      }
    }

    const status = await postScience(
      state.token,
      state.cookie,
      state.analyticsToken,
      events,
      session.superProps || session.getSuperProps(),
      settings.dryRun
    );

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
 * Dual-token stream forge: host posts video_stream_*, viewer posts stream_watch_*.
 * buildHostFor(game) -> { events, shared }
 * buildViewerFor(game, shared) -> events[]
 */
async function runDualStreamForges(games, buildHostFor, buildViewerFor, settings) {
  const state = vault.load();
  const total = games.length;
  const summary = { ok: 0, failed: 0, batches: 0, status: 0, viewerOk: 0, viewerFailed: 0 };
  const hasViewer = !!(state.viewerToken && state.viewerAnalyticsToken);

  for (let i = 0; i < games.length; i++) {
    summary.batches++;
    const game = games[i];
    const hostBuilt = buildHostFor(game);
    const hostEvents = hostBuilt.events || hostBuilt;
    const shared = hostBuilt.shared || { hasViewer };

    const hostStatus = await postScience(
      state.token,
      state.cookie,
      state.analyticsToken,
      hostEvents,
      session.superProps || session.getSuperProps(),
      settings.dryRun
    );

    if (hostStatus === 204) {
      summary.ok += 1;
    } else if (hostStatus === 401 || hostStatus === 403) {
      fail(`host http ${hostStatus} — renew host session (menu 6)`);
      summary.failed += 1;
      break;
    } else {
      summary.failed += 1;
      warn(`host http ${hostStatus || "network error"}`);
    }

    if (hasViewer && buildViewerFor) {
      const viewerEvents = buildViewerFor(game, { ...shared, hasViewer: true });
      const vStatus = await postScience(
        state.viewerToken,
        state.viewerCookie || state.cookie,
        state.viewerAnalyticsToken,
        viewerEvents,
        session.superProps || session.getSuperProps(),
        settings.dryRun
      );
      if (vStatus === 204) {
        summary.viewerOk += 1;
        info(
          `session ${summary.batches}/${total} ${CH.dim}${BULLET}${CH.reset} host ok + viewer ok`
        );
      } else if (vStatus === 401 || vStatus === 403) {
        warn(`viewer http ${vStatus} — check viewer token/cookie (menu 3 dual setup)`);
        summary.viewerFailed += 1;
      } else {
        warn(`viewer http ${vStatus || "network error"}`);
        summary.viewerFailed += 1;
      }
    } else {
      info(`session ${summary.batches}/${total} ${CH.dim}${BULLET}${CH.reset} host ${hostStatus === 204 ? "ok" : "fail"} (no viewer token)`);
    }

    if (i + 1 < games.length) {
      await sleep(nextBatchPause(settings, summary.batches));
    }
  }

  summary.status = summary.ok === total ? 204 : 0;
  return summary;
}

function recordRun(summary, hoursEach, dry, mode = "playtime") {
  const state = vault.load();
  if (!dry) {
    state.totals.titles += summary.ok;
    state.totals.hours += summary.ok * hoursEach;
    state.totals.runs += 1;
    if (mode === "stream") {
      state.totals.streamHours = (state.totals.streamHours || 0) + summary.ok * hoursEach;
    }
    state.lastRun = {
      at: new Date().toISOString(),
      ok: summary.ok,
      failed: summary.failed,
      hoursEach,
      mode,
      viewerOk: summary.viewerOk || 0,
    };
    vault.save();
  }
  journalAppend({
    ts: new Date().toISOString(),
    mode: dry ? "dry" : mode || "live",
    ok: summary.ok,
    failed: summary.failed,
    batches: summary.batches,
    hoursEach,
    totalHours: summary.ok * hoursEach,
    viewerOk: summary.viewerOk || 0,
    viewerFailed: summary.viewerFailed || 0,
  });
}

module.exports = { runForges, runDualStreamForges, recordRun, journalAppend, postScience };
