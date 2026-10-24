"use strict";
const fs = require("node:fs");
const path = require("node:path");
const runtime = require("./runtime");
const vault = require("./vault");
const ui = require("./ui");
const log = require("./log");
const session = require("./session");
const science = require("./science");
const forge = require("./forge");
const games = require("./games");
const auth = require("./auth");
const badges = require("./badges");
const checkpoint = require("./checkpoint");
const { request } = require("./http");
const { PATHS, LIMITS } = require("./config");
const fmt = require("./format");

async function settle() { if (!runtime.isAutomatic()) await log.pause(); }
function filteredCatalog(catalog) { return games.applyFilter(catalog, vault.load().settings.catalogFilter); }
function pickRotating(catalog, count) {
  if (!Number.isInteger(count) || count < 1 || count > LIMITS.maxTitles) throw new Error("Invalid title count.");
  const seen = new Set(vault.load().recentIds);
  const unique = [...new Map(catalog.map(g => [g.id, g])).values()];
  return unique.filter(g => !seen.has(g.id)).concat(unique.filter(g => seen.has(g.id))).slice(0, count);
}
function validateRun(picked, hours) {
  if (!Array.isArray(picked) || !picked.length) throw new Error("Select at least one title.");
  if (!Number.isFinite(hours) || hours <= 0 || hours > LIMITS.maxHours) throw new Error("Invalid duration.");
  if (!runtime.isOffline() && picked.some(g => g.demo)) throw new Error("Demo titles cannot be submitted.");
}
async function requireReady() {
  if (runtime.isOffline()) return true;
  const s = vault.load();
  for (const [field, label] of [["token", "Discord account token"], ["cookie", "Discord cookie header"]]) {
    if (!s[field]) {
      if (runtime.isAutomatic()) throw new Error("Credentials are missing for this profile.");
      s[field] = await ui.askSecret(label + ": ");
      if (!s[field]) throw new Error(label + " is required.");
      log.registerSecret(s[field]);
    }
  }
  if (!session.getSuperProps()) await session.begin();
  if (!vault.tokenFresh()) await session.renew();
  return true;
}
function summarize(summary, units) {
  if (summary.dryRun || runtime.isOffline()) {
    log.info("Preview complete: " + (summary.planned ?? units) + " planned units. No requests, credentials, or state writes.");
    return;
  }
  log.info("Accepted this run: " + summary.ok + " units; " + fmt.hours(summary.acceptedHours || 0) + " submitted duration.");
  log.info("Discord badge credit: UNVERIFIED. Check the badge in Discord.");
  if (summary.skipped) log.info("Resumed after " + summary.skipped + " previously accepted units.");
  if (summary.failed) { log.warn("Stopped after a failed or uncertain submission. Earlier batches may have been accepted."); process.exitCode = 1; }
  if (summary.checkpointError) { log.warn("Checkpoint storage failed; the run stopped."); process.exitCode = 1; }
  if (summary.cancelled) { log.warn("Cancelled. Accepted batches remain submitted."); process.exitCode = 130; }
}
function persistSummary(summary, hours, mode) {
  if (runtime.isOffline()) return;
  try {
    forge.recordRun(summary, hours, false, { mode });
    if (mode !== "stream" && summary.acceptedIds?.length) vault.rotateMemory(summary.acceptedIds);
  } catch (_) {
    summary.persistenceError = true;
    process.exitCode = 1;
    log.warn("Local bookkeeping could not be saved. Accepted submissions still reached Discord; avoid automatically replaying this run.");
  }
}
async function executeForge(picked, hoursEach, mode = "playtime", plan = null) {
  validateRun(picked, hoursEach);
  await requireReady();
  const s = vault.load();
  s.settings.dryRun = runtime.isOffline();
  const ms = mode === "variety" ? 60000 : Math.max(1000, Math.floor(hoursEach * 3600000));
  const durations = plan ? new Map(plan.gameIds.map((id, i) => [id, plan.durationsMs[i]])) : null;
  const builder = g => science.buildSessionTriplet(g, durations?.get(g.id) ?? ms);
  log.info((runtime.isOffline() ? "Preview" : "Submitting") + ": " + mode + " / " + picked.length + " titles");
  const summary = await forge.runForges(picked, builder, s.settings, { mode, ...(plan ? { plan } : {}) });
  persistSummary(summary, hoursEach, mode);
  summarize(summary, picked.length);
  await settle();
  return summary;
}
async function executeStreamForge(picked, totalHours, sessions, plan = null) {
  validateRun(picked, totalHours);
  await requireReady();
  const s = vault.load();
  s.settings.dryRun = runtime.isOffline();
  const built = plan
    ? { events: picked.flatMap((g, i) => science.buildStreamPair(g, plan.durationsMs[i])),
        sessions: picked.length, hoursEach: totalHours / picked.length }
    : science.buildStreamBatch(picked, totalHours, sessions);
  log.warn("Streaming is experimental. Accepted events do not establish streaming badge credit.");
  const summary = await forge.runEventBatches(built.events, s.settings, {
    eventChunkSize: 40, label: "stream", ...(plan ? { plan } : {}),
  });
  persistSummary(summary, built.hoursEach, "stream");
  summarize(summary, built.sessions);
  await settle();
  return summary;
}
async function askCount(fallback, max) {
  return ui.askNumber("How many titles [" + fallback + "]: ", fallback, { integer: true, min: 1, max: Math.min(max, LIMITS.maxTitles) });
}
async function askHours(label, fallback) {
  return ui.askNumber(label + " [" + fallback + "]: ", fallback, { min: 1 / 3600, max: LIMITS.maxHours });
}
async function forgeBulk(ctx) {
  const catalog = filteredCatalog(ctx.games);
  if (!catalog.length) throw new Error("No catalog matches.");
  const n = await askCount(Math.min(20, catalog.length), catalog.length);
  const h = await askHours("Hours per title", vault.load().settings.hoursDefault);
  if (n === null || h === null) throw new Error("Invalid count or duration.");
  await executeForge(pickRotating(catalog, n), h, "playtime");
}
async function forgeTitles(ctx) {
  const matches = games.searchGames(filteredCatalog(ctx.games), await ui.ask("Search titles: "));
  const picked = await ui.chooseGames(matches);
  if (!picked.length) return;
  const h = await askHours("Hours per title", 1);
  if (h === null) throw new Error("Invalid duration.");
  await executeForge(picked, h, "playtime");
}
async function forgeVariety(ctx) {
  const catalog = filteredCatalog(ctx.games);
  const n = await askCount(Math.min(100, catalog.length), catalog.length);
  if (n === null) throw new Error("Invalid count.");
  await executeForge(pickRotating(catalog, n), 1 / 60, "variety");
}
async function forgeStream(ctx) {
  const h = await askHours("Total stream hours", 5);
  if (h === null) throw new Error("Invalid duration.");
  const catalog = filteredCatalog(ctx.games);
  const n = Math.min(catalog.length, 100, Math.max(1, Math.ceil(h / 10)));
  await executeStreamForge(pickRotating(catalog, n), h, n);
}
async function forgeAll(ctx) {
  log.info("This runs playtime, variety, and experimental streaming.");
  const catalog = filteredCatalog(ctx.games);
  const n = await askCount(Math.min(20, catalog.length), catalog.length);
  const h = await askHours("Playtime hours per title", 1);
  const streamHours = await askHours("Total experimental stream hours", 5);
  if ([n, h, streamHours].includes(null)) throw new Error("Invalid plan.");
  const picked = pickRotating(catalog, n);
  let result = await executeForge(picked, h, "playtime");
  if (result.failed || result.cancelled || result.checkpointError || result.persistenceError) return;
  result = await executeForge(picked, 1 / 60, "variety");
  if (result.failed || result.cancelled || result.checkpointError || result.persistenceError) return;
  const sessions = Math.min(catalog.length, 100, Math.max(1, Math.ceil(streamHours / 10)));
  await executeStreamForge(pickRotating(catalog, sessions), streamHours, sessions);
}
async function showLadder() {
  const s = vault.load();
  ui.section("BADGE REFERENCE");
  log.info("These are reference thresholds and local accepted totals. Earned badges are unknown.");
  for (const [name, ladder, key, total] of [
    ["Game time", badges.GAME_TIME, "hours", s.totals.hours],
    ["Streaming · experimental", badges.STREAM, "hours", s.totals.streamHours],
    ["Game variety", badges.VARIETY, "titles", s.totals.varietyTitles],
  ]) {
    log.blank(); log.keyValue(name + " / locally submitted", total);
    for (const tier of ladder) log.plain(String(tier[key]).padStart(6) + " " + key + "  " + tier.name);
    const next = badges.nextTier(ladder, total, key);
    if (next) log.info("Next reference threshold: " + next.name + " (gap " + (next[key] - total) + ")");
  }
  await settle();
}
async function forgeToNextTier(ctx) {
  log.info("This plans from local accepted totals; it cannot determine your earned tier.");
  const choice = await ui.ask("1 Game time / 2 Streaming / 3 Variety: ");
  const s = vault.load(), catalog = filteredCatalog(ctx.games);
  const mode = { "1": "playtime", "2": "stream", "3": "variety" }[choice];
  if (!mode) return;
  const key = mode === "variety" ? "titles" : "hours";
  const ladder = mode === "variety" ? badges.VARIETY : mode === "stream" ? badges.STREAM : badges.GAME_TIME;
  const value = mode === "variety" ? s.totals.varietyTitles : mode === "stream" ? s.totals.streamHours : s.totals.hours;
  const next = badges.nextTier(ladder, value, key);
  if (!next) { log.info("Local total meets the highest reference threshold."); return settle(); }
  const need = next[key] - value;
  if (mode === "variety") await executeForge(pickRotating(catalog, Math.ceil(need)), 1 / 60, mode);
  else if (mode === "stream") {
    const n = Math.min(catalog.length, 100, Math.max(1, Math.ceil(need / 10)));
    await executeStreamForge(pickRotating(catalog, n), need, n);
  } else {
    const picked = pickRotating(catalog, Math.min(20, catalog.length));
    await executeForge(picked, need / picked.length, mode);
  }
}
async function profilesMenu() {
  const s = vault.load();
  log.info("Current profile: " + s.activeProfile + ". Credentials are never included in profile files.");
  log.info("Profiles: " + vault.listProfiles().join(", "));
  const c = await ui.ask("1 Switch / 2 Save metadata as / 3 Export sanitized metadata / 4 Import metadata: ");
  if (c === "1" || c === "2") {
    const name = await ui.ask("Profile name: ");
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(name)) throw new Error("Invalid profile name.");
    if (c === "1") vault.switchProfile(name); else vault.saveProfile(name);
    vault.load().settings.dryRun = runtime.isOffline();
    session.clear();
    log.info("Profile changed. Enter credentials for this profile when starting a live run.");
  } else if (c === "3") {
    if (runtime.isOffline()) { log.info("Offline preview: export would contain metadata only; nothing written."); return settle(); }
    const out = path.join(PATHS.dataRoot, "metadata-export-" + Date.now() + ".json");
    fs.mkdirSync(PATHS.dataRoot, { recursive: true });
    fs.writeFileSync(out, JSON.stringify(vault.exportVault(), null, 2), { mode: 0o600 });
    log.info("Sanitized metadata exported to " + out);
  } else if (c === "4") {
    if (runtime.isOffline()) { log.info("Imports are disabled in the offline preview."); return settle(); }
    const filename = await ui.ask("Metadata JSON path: ");
    const st = fs.statSync(filename);
    if (st.size > 2 * 1024 * 1024) throw new Error("Import is too large.");
    vault.importVault(JSON.parse(fs.readFileSync(filename, "utf8")));
    vault.load().settings.dryRun = runtime.isOffline();
    session.clear();
    log.info("Metadata imported; credential fields were ignored.");
  }
  await settle();
}
async function resumeCheckpoint(ctx) {
  const cp = checkpoint.load();
  if (!cp?.plan) { log.info("No compatible pending run."); return settle(); }
  log.info("Pending " + cp.plan.mode + " / profile " + cp.plan.profile + " / offset " + cp.index);
  const c = await ui.ask("r Resume this exact plan / c Clear / Enter back: ");
  if (c === "c") { checkpoint.clear(); log.info("Checkpoint cleared."); return settle(); }
  if (c !== "r") return;
  await requireReady();
  const s = vault.load();
  if (cp.plan.profile !== s.activeProfile) throw new Error("Switch to the checkpoint's profile before resuming.");
  const byId = new Map(ctx.games.map(g => [g.id, g]));
  const picked = cp.plan.gameIds.map(id => byId.get(id));
  if (picked.some(g => !g)) throw new Error("The catalog no longer contains every checkpoint title.");
  const total = cp.plan.durationsMs.reduce((a, b) => a + b, 0) / 3600000;
  if (cp.plan.mode === "stream") await executeStreamForge(picked, total, picked.length, cp.plan);
  else await executeForge(picked, total / picked.length, cp.plan.mode, cp.plan);
}
async function bindFingerprint() {
  if (runtime.isOffline()) { log.info("Fingerprint input is disabled in offline preview."); return settle(); }
  log.info("Optional captured executable fingerprint. Kept in memory; usefulness for badge credit is unverified.");
  const value = await ui.askSecret("Fingerprint (Enter to clear): ");
  vault.load().fingerprint = value;
  if (value) log.registerSecret(value);
  log.info(value ? "Fingerprint set for this session." : "Fingerprint cleared.");
  await settle();
}
async function probeStats() {
  if (runtime.isOffline()) { log.info("Offline preview: no account or badge lookup."); return showLadder(); }
  await requireReady();
  const res = await request("https://discord.com/api/v9/users/@me", { headers: auth.buildHeaders() });
  if (!res.ok) throw new Error("Account lookup failed (HTTP " + res.status + ").");
  const me = await res.json();
  log.keyValue("Account", me.username || me.id);
  log.info("Account authentication confirmed. Actual badge progress is unavailable.");
  await showLadder();
}
async function renewSession() {
  if (runtime.isOffline()) { log.info("Session renewal is disabled in offline preview."); return settle(); }
  vault.clearSecrets(); session.clear();
  await requireReady();
  log.info("Session renewed. Credentials remain in memory.");
  await settle();
}
async function catalogScan(ctx) {
  const found = games.searchGames(filteredCatalog(ctx.games), await ui.ask("Search catalog: "));
  for (const g of found) log.plain(g.name + "  <" + g.id + ">" + (g.demo ? "  DEMO" : ""));
  if (!found.length) log.info("No matches.");
  await settle();
}
async function editSettings() {
  const s = vault.load();
  log.info("Execution mode is fixed for this process. Relaunch with --live to send.");
  log.info("Current: batch " + s.settings.batchSize + ", pause " + s.settings.batchPauseMs + "ms, filter " + s.settings.catalogFilter);
  const c = await ui.ask("1 Batch size / 2 Pause / 3 Filter / 4 Retries / 5 Pace / Enter back: ");
  if (c === "1") {
    const n = await ui.askNumber("Games per batch [20]: ", 20, { integer: true, min: 1, max: 50 });
    if (n === null) throw new Error("Invalid batch size."); s.settings.batchSize = n;
  } else if (c === "2") {
    const n = await ui.askNumber("Pause milliseconds [1500]: ", 1500, { integer: true, min: 1000, max: 60000 });
    if (n === null) throw new Error("Invalid pause."); s.settings.batchPauseMs = n;
  } else if (c === "3") {
    const value = await ui.ask("all / verified / steam / no-launcher: ");
    if (!["all", "verified", "steam", "no-launcher"].includes(value)) throw new Error("Invalid filter.");
    s.settings.catalogFilter = value;
  } else if (c === "4") {
    const n = await ui.askNumber("Rate-limit retries [3]: ", 3, { integer: true, min: 0, max: 4 });
    if (n === null) throw new Error("Invalid retries."); s.settings.maxRetries = n;
  } else if (c === "5") {
    const value = await ui.ask("standard / drip: ");
    if (!["standard", "drip"].includes(value)) throw new Error("Invalid pace.");
    s.settings.pace = value;
  }
  vault.save();
}
async function showJournal() {
  const stats = forge.journalStats();
  log.info(stats.total + " local run records. These do not verify badge credit.");
  for (const row of stats.rows.slice(-LIMITS.journalTail).reverse()) {
    log.plain(row.ts + "  " + row.mode + "  accepted=" + row.ok + "  failed=" + row.failed + "  hours=" + (row.totalHours || 0));
  }
  await settle();
}
async function toolsSubmenu(ctx) {
  const c = await ui.ask("a Account / b Catalog / c Settings / d Journal / e Ladder / f Profiles / g Resume: ");
  const actions = { a: probeStats, b: catalogScan, c: editSettings, d: showJournal,
    e: showLadder, f: profilesMenu, g: resumeCheckpoint };
  if (actions[c]) await actions[c](ctx);
}
module.exports = { forgeBulk, forgeTitles, forgeVariety, forgeStream, forgeAll,
  forgeToNextTier, showLadder, profilesMenu, resumeCheckpoint, bindFingerprint,
  probeStats, renewSession, catalogScan, editSettings, showJournal, toolsSubmenu,
  requireReady, pickRotating, executeForge, executeStreamForge, filteredCatalog };
