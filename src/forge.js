"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ENDPOINTS, PATHS, CLIENT, LIMITS } = require("./config");
const vault = require("./vault");
const session = require("./session");
const checkpoint = require("./checkpoint");
const runtime = require("./runtime");
const http = require("./http");
const { CH, warn } = require("./log");

const isDry = (settings = {}) => Boolean(settings.dryRun || runtime.isOffline());
const positive = (value) => Number.isFinite(value) && value > 0 ? value : 0;

function journalAppend(entry) {
  if (runtime.isOffline()) return;
  fs.mkdirSync(path.dirname(PATHS.journal), { recursive: true, mode: 0o700 });
  fs.appendFileSync(PATHS.journal, JSON.stringify(entry) + "\n", { encoding: "utf-8", mode: 0o600 });
}

function progressLine(done, total, startedAt, label) {
  if (!process.stdout.isTTY) return;
  const pct = total ? Math.min(100, Math.floor(done / total * 100)) : 0;
  const filled = Math.floor(pct / 5);
  const eta = done > 0 ? (Date.now() - startedAt) / 1000 / done * (total - done) : 0;
  process.stdout.write(`\r  ${CH.dim}${"█".repeat(filled)}${"░".repeat(20 - filled)}${CH.reset} ${pct}% ${done}/${total} ${label || ""} ETA ${Math.ceil(eta)}s   `);
  if (done >= total) process.stdout.write("\n");
}

function dumpDebug(events, status) {
  if (runtime.isOffline()) return null;
  // Only schema-level counts are written. Properties can contain account data.
  const allowed = new Set(["launch_game", "running_game_heartbeat", "video_stream_started", "video_stream_ended"]);
  const eventTypes = {};
  for (const event of events) {
    const type = allowed.has(event.type) ? event.type : "other";
    eventTypes[type] = (eventTypes[type] || 0) + 1;
  }
  try {
    fs.mkdirSync(PATHS.debugDir, { recursive: true, mode: 0o700 });
    const file = path.join(PATHS.debugDir, `request-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.json`);
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), status: Number(status) || 0,
      count: events.length, eventTypes }, null, 2), { encoding: "utf-8", mode: 0o600 });
    return file;
  } catch (_) { return null; }
}

async function sendScience(events, settings, maxRetries) {
  if (isDry(settings)) return 0;
  runtime.assertOnline();
  const state = vault.load();
  if (!state.token || !state.analyticsToken) throw new Error("Account session is not ready.");
  try {
    const response = await http.request(ENDPOINTS.science, {
      method: "POST", maxRetries, timeoutMs: settings.requestTimeoutMs || LIMITS.requestTimeoutMs || 15000,
      headers: {
        accept: "*/*", "accept-language": CLIENT.locale, authorization: state.token,
        "content-type": "application/json", cookie: state.cookie || "", origin: "https://discord.com",
        referer: "https://discord.com/channels/@me", "user-agent": CLIENT.agent,
        "x-discord-locale": CLIENT.locale, "x-discord-timezone": CLIENT.timezone,
        "x-super-properties": session.superProps || session.getSuperProps(),
      },
      body: JSON.stringify({ token: state.analyticsToken, events }),
    });
    if (settings.debugDump === true) dumpDebug(events, response.status);
    return response.status;
  } catch (error) {
    if (runtime.signal().aborted || error.name === "AbortError") throw error;
    if (settings.debugDump === true) dumpDebug(events, 0);
    return 0;
  }
}

async function postScience(events, settings = {}) { return sendScience(events, settings, 0); }
async function postWithRetry(events, settings = {}) {
  return sendScience(events, settings, settings.maxRetries == null ? LIMITS.maxRetries : settings.maxRetries);
}

function accountId(state) {
  const encoded = String(state.token || "").split(".")[0];
  let decoded = "";
  try { decoded = Buffer.from(encoded, "base64url").toString("utf8"); } catch (_) {}
  return /^\d+$/.test(decoded) ? decoded : `sha256:${crypto.createHash("sha256").update(String(state.token || "")).digest("hex")}`;
}

function planFor(mode, gameIds, durationsMs, supplied) {
  const state = vault.load();
  const plan = checkpoint.createPlan({ accountId: accountId(state), profile: state.activeProfile || "default",
    mode, gameIds, durationsMs });
  if (supplied && checkpoint.createPlan(supplied).fingerprint !== plan.fingerprint) {
    throw new Error("The saved plan does not match this account, profile, titles, or durations.");
  }
  return plan;
}

function gameDuration(events) {
  const started = new Set();
  const completed = new Set();
  let ms = 0;
  for (const event of events) {
    const p = event.properties || {};
    if (event.type !== "running_game_heartbeat" || !p.game_session_id) continue;
    const id = `${p.game_id}:${p.game_session_id}`;
    if (p.initial_heartbeat) started.add(id);
    if (p.final_heartbeat && started.has(id) && !completed.has(id)) {
      completed.add(id);
      ms += positive(p.duration_tracked_ms);
    }
  }
  return ms;
}

function streamPairs(events) {
  if (events.length % 2) throw new Error("Streaming events must contain complete start/end pairs.");
  const pairs = [];
  const seen = new Set();
  for (let i = 0; i < events.length; i += 2) {
    const start = events[i];
    const end = events[i + 1];
    const a = start.properties || {};
    const b = end.properties || {};
    if (start.type !== "video_stream_started" || end.type !== "video_stream_ended" ||
        !a.media_session_id || a.media_session_id !== b.media_session_id ||
        !a.game_id || String(a.game_id) !== String(b.game_id) || seen.has(a.media_session_id)) {
      throw new Error("Streaming events contain an incomplete or duplicate session.");
    }
    seen.add(a.media_session_id);
    pairs.push({ id: String(a.game_id), durationMs: positive(b.duration_ms == null ? b.duration : b.duration_ms),
      events: [start, end] });
  }
  return pairs;
}

function emptySummary(planned, dryRun) {
  return { ok: 0, failed: 0, batches: 0, status: 0, lastStatus: 0, skipped: 0,
    dryRun, planned, plannedHours: 0, cancelled: false, acceptedIds: [], acceptedHours: 0,
    completedSessions: 0, eventOk: 0 };
}

async function pauseBetween(settings) {
  let pause = Number.isFinite(settings.batchPauseMs) ? Math.max(0, settings.batchPauseMs) : 300;
  if (settings.pace === "drip") pause = Math.max(pause, settings.dripPauseMs || 15 * 60 * 1000);
  await runtime.sleep(pause);
}

function writeCheckpoint(plan, index, total, summary) {
  try { checkpoint.save({ plan, index, total }); return true; }
  catch (_) {
    summary.checkpointError = true;
    warn("Could not save the checkpoint; stopping to avoid an unsafe resume.");
    return false;
  }
}

function finishCheckpoint(summary) {
  try { checkpoint.clear(); }
  catch (_) {
    summary.checkpointError = true;
    warn("The completed checkpoint could not be removed; accepted counts are retained.");
  }
  summary.status = 204;
}

async function runForges(games, buildEventsFor, settings = {}, options = {}) {
  const mode = options.mode || "playtime";
  const summary = emptySummary(games.length, isDry(settings));
  if (summary.dryRun) return summary;
  runtime.assertOnline();
  const size = settings.batchSize == null ? 50 : settings.batchSize;
  if (!Number.isSafeInteger(size) || size < 1 || size > 100) throw new Error("Batch size must be between 1 and 100.");
  const units = games.map((game) => {
    const events = buildEventsFor(game);
    if (!Array.isArray(events) || !events.length) throw new Error("A title has no events.");
    return { id: String(game.id), events, durationMs: gameDuration(events) };
  });
  const plan = planFor(mode, units.map((unit) => unit.id), units.map((unit) => unit.durationMs), options.plan);
  summary.plannedHours = plan.durationsMs.reduce((sum, value) => sum + value, 0) / 3600000;
  summary.skipped = checkpoint.resumeIndex(plan, units.length);
  if (!writeCheckpoint(plan, summary.skipped, units.length, summary)) return summary;
  const startedAt = Date.now();
  try {
    for (let index = summary.skipped; index < units.length; index += size) {
      runtime.signal().throwIfAborted();
      const chunk = units.slice(index, index + size);
      summary.batches++;
      const events = chunk.flatMap((unit) => unit.events);
      const status = await postWithRetry(events, settings);
      summary.lastStatus = status;
      if (status !== 204) {
        summary.failed += chunk.length;
        warn(status ? `Stopped at batch ${summary.batches}: HTTP ${status}.` : "Stopped: request delivery is uncertain; no automatic replay was attempted.");
        break;
      }
      summary.ok += chunk.length;
      summary.eventOk += events.length;
      summary.completedSessions += chunk.length;
      summary.acceptedIds.push(...chunk.map((unit) => unit.id));
      summary.acceptedHours += chunk.reduce((sum, unit) => sum + unit.durationMs, 0) / 3600000;
      progressLine(summary.skipped + summary.ok, units.length, startedAt, mode);
      if (!writeCheckpoint(plan, index + chunk.length, units.length, summary)) break;
      if (index + chunk.length < units.length) await pauseBetween(settings);
    }
  } catch (error) {
    if (runtime.signal().aborted || error.name === "AbortError") summary.cancelled = true;
    else throw error;
  }
  summary.acceptedIds = [...new Set(summary.acceptedIds)];
  if (!summary.cancelled && !summary.checkpointError && summary.ok + summary.skipped === units.length) {
    finishCheckpoint(summary);
  }
  return summary;
}

async function runEventBatches(events, settings = {}, options = {}) {
  const label = options.label || "stream events";
  const mode = options.mode || (label.startsWith("stream") ? "stream" : label);
  const summary = emptySummary(events.length, isDry(settings));
  if (summary.dryRun) return summary;
  runtime.assertOnline();
  const pairs = streamPairs(events);
  const requestedSize = options.eventChunkSize == null ? 80 : options.eventChunkSize;
  if (!Number.isSafeInteger(requestedSize) || requestedSize < 2 || requestedSize > 200) throw new Error("Event batch size must be between 2 and 200.");
  const pairSize = Math.floor(requestedSize / 2);
  const plan = planFor(mode, pairs.map((pair) => pair.id), pairs.map((pair) => pair.durationMs), options.plan);
  summary.plannedHours = plan.durationsMs.reduce((sum, value) => sum + value, 0) / 3600000;
  summary.skipped = checkpoint.resumeIndex(plan, events.length);
  if (summary.skipped % 2 !== 0) summary.skipped = 0;
  if (!writeCheckpoint(plan, summary.skipped, events.length, summary)) return summary;
  const startedAt = Date.now();
  try {
    for (let index = summary.skipped / 2; index < pairs.length; index += pairSize) {
      runtime.signal().throwIfAborted();
      const chunk = pairs.slice(index, index + pairSize);
      summary.batches++;
      const status = await postWithRetry(chunk.flatMap((pair) => pair.events), settings);
      summary.lastStatus = status;
      if (status !== 204) {
        summary.failed += chunk.length;
        warn(status ? `Stopped at batch ${summary.batches}: HTTP ${status}.` : "Stopped: request delivery is uncertain; no automatic replay was attempted.");
        break;
      }
      summary.ok += chunk.length;
      summary.completedSessions += chunk.length;
      summary.eventOk += chunk.length * 2;
      summary.acceptedIds.push(...chunk.map((pair) => pair.id));
      summary.acceptedHours += chunk.reduce((sum, pair) => sum + pair.durationMs, 0) / 3600000;
      progressLine(summary.eventOk + summary.skipped, events.length, startedAt, label);
      if (!writeCheckpoint(plan, (index + chunk.length) * 2, events.length, summary)) break;
      if (index + chunk.length < pairs.length) await pauseBetween(settings);
    }
  } catch (error) {
    if (runtime.signal().aborted || error.name === "AbortError") summary.cancelled = true;
    else throw error;
  }
  summary.acceptedIds = [...new Set(summary.acceptedIds)];
  if (!summary.cancelled && !summary.checkpointError && summary.eventOk + summary.skipped === events.length) {
    finishCheckpoint(summary);
  }
  return summary;
}

function recordRun(summary, hoursEach, dry, extra = {}) {
  if (dry || summary.dryRun || runtime.isOffline()) return;
  const state = vault.load();
  const acceptedHours = positive(summary.acceptedHours);
  const acceptedIds = [...new Set((summary.acceptedIds || []).map(String))];
  const mode = ["stream", "variety", "playtime"].includes(extra.mode) ? extra.mode : "playtime";
  if (summary.ok > 0) {
    if (mode === "stream") state.totals.streamHours = (state.totals.streamHours || 0) + acceptedHours;
    else {
      const known = new Set(state.acceptedGameIds || []);
      const newIds = acceptedIds.filter((id) => !known.has(id));
      state.acceptedGameIds = [...new Set([...known, ...acceptedIds])];
      state.totals.titles = (state.totals.titles || 0) + newIds.length;
      state.totals.varietyTitles = (state.totals.varietyTitles || 0) + newIds.length;
      state.totals.hours = (state.totals.hours || 0) + acceptedHours;
    }
    state.totals.runs = (state.totals.runs || 0) + 1;
    state.lastRun = { at: new Date().toISOString(), mode, ok: summary.ok, failed: summary.failed,
      hoursEach: positive(hoursEach), acceptedHours, acceptedIds, cancelled: Boolean(summary.cancelled) };
    vault.save();
  }
  journalAppend({ ts: new Date().toISOString(), mode, ok: summary.ok, failed: summary.failed,
    batches: summary.batches, hoursEach: positive(hoursEach), totalHours: acceptedHours,
    eventOk: summary.eventOk || 0, cancelled: Boolean(summary.cancelled), profile: state.activeProfile });
}

function journalStats() {
  if (runtime.isOffline()) return { rows: [], byMode: {}, ok: 0, fail: 0, hours: 0, total: 0 };
  let rows = [];
  try {
    rows = fs.readFileSync(PATHS.journal, "utf-8").split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter((row) => row && typeof row === "object" && row.mode !== "dry");
  } catch (_) {}
  const byMode = {};
  let ok = 0, fail = 0, hours = 0;
  for (const row of rows) {
    const mode = ["stream", "variety", "playtime", "live"].includes(row.mode) ? row.mode : "other";
    byMode[mode] = byMode[mode] || { runs: 0, ok: 0, fail: 0, hours: 0 };
    byMode[mode].runs++;
    byMode[mode].ok += positive(row.ok);
    byMode[mode].fail += positive(row.failed);
    byMode[mode].hours += positive(row.totalHours);
    ok += positive(row.ok);
    fail += positive(row.failed);
    hours += positive(row.totalHours);
  }
  return { rows, byMode, ok, fail, hours, total: rows.length };
}

module.exports = { runForges, runEventBatches, recordRun, journalAppend, postScience, postWithRetry,
  progressLine, journalStats, dumpDebug, accountId };
