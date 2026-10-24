"use strict";

// Modified 2026-10-24: credentials exist only in this process. Disk snapshots,
// imports and exports contain an explicit allowlist of non-secret metadata.
const fs = require("fs");
const path = require("path");
const { PATHS, LIMITS, DEFAULT_SETTINGS } = require("./config");
const runtime = require("./runtime");

const SECRET_KEYS = ["token", "cookie", "fingerprint", "analyticsToken"];
const FILTERS = ["all", "verified", "steam", "no-launcher"];
let cache = null;
let offlineCache = null;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function bounded(value, fallback, min, max, integer = false) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const result = Math.max(min, Math.min(max, number));
  return integer ? Math.trunc(result) : result;
}
function positive(value, fallback, max = 1_000_000) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(value, max) : fallback;
}
function sanitizeSettings(value) {
  const input = record(value);
  const d = DEFAULT_SETTINGS;
  return {
    batchSize: bounded(input.batchSize, d.batchSize, 1, 50, true),
    batchPauseMs: bounded(input.batchPauseMs, d.batchPauseMs, 0, 86_400_000, true),
    wobble: typeof input.wobble === "boolean" ? input.wobble : d.wobble,
    dryRun: typeof input.dryRun === "boolean" ? input.dryRun : d.dryRun,
    hoursDefault: positive(input.hoursDefault, d.hoursDefault),
    pace: ["standard", "aggressive", "drip"].includes(input.pace) ? input.pace : d.pace,
    dripHoursPerDay: positive(input.dripHoursPerDay, d.dripHoursPerDay, 24),
    dripPauseMs: bounded(input.dripPauseMs, d.dripPauseMs, 0, 86_400_000, true),
    catalogFilter: FILTERS.includes(input.catalogFilter) ? input.catalogFilter : d.catalogFilter,
    maxRetries: bounded(input.maxRetries, d.maxRetries, 0, 4, true),
    debugDump: typeof input.debugDump === "boolean" ? input.debugDump : d.debugDump,
  };
}
function cleanName(name) {
  return String(name || "default").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default";
}
function cleanAccountId(value) {
  return typeof value === "string" && /^\d{1,30}$/.test(value) ? value : "";
}
function cleanIds(ids, recent = false) {
  const clean = [...new Set((Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === "string" && /^\d{1,30}$/.test(id)))];
  return recent ? clean.slice(-LIMITS.replayMemory) : clean;
}
function cleanTotals(value) {
  const input = record(value);
  const out = {};
  for (const key of ["titles", "hours", "runs", "streamHours", "varietyTitles"]) {
    out[key] = bounded(input[key], 0, 0, Number.MAX_SAFE_INTEGER, !key.toLowerCase().includes("hours"));
  }
  return out;
}
function cleanLastRun(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  if (typeof value.at === "string" && Number.isFinite(Date.parse(value.at))) {
    out.at = new Date(value.at).toISOString();
  }
  if (["playtime", "variety", "stream", "all", "dry", "preview"].includes(value.mode)) out.mode = value.mode;
  for (const key of ["ok", "failed", "hoursEach", "totalHours", "acceptedHours", "eventOk", "batches", "sessions"]) {
    if (typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0) {
      out[key] = Math.min(value[key], Number.MAX_SAFE_INTEGER);
    }
  }
  if (Array.isArray(value.acceptedIds)) out.acceptedIds = cleanIds(value.acceptedIds);
  return Object.keys(out).length ? out : null;
}
function metadata(value, name) {
  const input = record(value);
  return {
    version: 4,
    activeProfile: cleanName(name || input.activeProfile || input.name),
    accountId: cleanAccountId(input.accountId),
    settings: sanitizeSettings(input.settings),
    totals: cleanTotals(input.totals),
    lastRun: cleanLastRun(input.lastRun),
    recentIds: cleanIds(input.recentIds, true),
    acceptedGameIds: cleanIds(input.acceptedGameIds),
  };
}
function defaults(value, name) {
  return { ...metadata(value, name), token: "", cookie: "", fingerprint: "", analyticsToken: "", mintedAt: 0 };
}
function readMetadata(file) {
  if (runtime.isOffline()) return null;
  try { return record(JSON.parse(fs.readFileSync(file, "utf-8"))); }
  catch (_) { return null; }
}
function writeMetadata(file, value) {
  if (runtime.isOffline()) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(metadata(value), null, 2), { encoding: "utf-8", mode: 0o600 });
}
function profilePath(name) {
  return path.join(PATHS.profilesDir, `${cleanName(name)}.json`);
}
function load() {
  if (runtime.isOffline()) {
    if (!offlineCache) offlineCache = defaults();
    return offlineCache;
  }
  // The old science_state.json is deliberately never read or migrated.
  if (!cache) cache = defaults(readMetadata(PATHS.vault));
  return cache;
}
function save() {
  const state = runtime.isOffline() ? offlineCache : cache;
  if (!state) return;
  const safe = metadata(state);
  Object.assign(state, safe);
  if (!runtime.isOffline()) writeMetadata(PATHS.vault, safe);
}
function clearStateSecrets(state) {
  if (!state) return;
  for (const key of SECRET_KEYS) state[key] = "";
  state.mintedAt = 0;
}
function clearSecrets() {
  clearStateSecrets(cache);
  clearStateSecrets(offlineCache);
}
function hasActivity(state) {
  return Object.values(cleanTotals(state.totals)).some(value => value > 0) ||
    cleanIds(state.acceptedGameIds).length > 0 || cleanIds(state.recentIds).length > 0 ||
    cleanIds(state.lastRun?.acceptedIds).length > 0 || Number(state.lastRun?.ok) > 0;
}
// Called only after Discord's identity endpoint has verified the current token.
function bindAccount(accountId) {
  if (runtime.isOffline()) throw new Error("Account binding is disabled in the offline preview.");
  const id = cleanAccountId(accountId);
  if (!id) { clearSecrets(); throw new Error("Discord returned an invalid account identity."); }
  const state = load();
  if (state.accountId && state.accountId !== id) {
    clearSecrets();
    throw new Error("This profile belongs to a different account. Use a different --profile.");
  }
  if (!state.accountId && hasActivity(state)) {
    clearSecrets();
    throw new Error("This profile has activity with no verified account identity. Use a fresh --profile.");
  }
  if (!state.accountId) {
    state.accountId = id;
    save();
  }
  return state;
}
function tokenFresh() {
  if (runtime.isOffline()) return false;
  const s = load();
  const age = Date.now() - s.mintedAt;
  return Boolean(s.token && s.analyticsToken && Number.isFinite(age) && age >= 0 && age < LIMITS.tokenTTL);
}
function rotateMemory(ids) {
  const s = load();
  s.recentIds = cleanIds(s.recentIds.concat(Array.isArray(ids) ? ids : []), true);
  save();
}
function listProfiles() {
  const names = new Set(["default", load().activeProfile]);
  if (!runtime.isOffline()) {
    try {
      for (const file of fs.readdirSync(PATHS.profilesDir)) {
        if (/^[a-zA-Z0-9_-]{1,64}\.json$/.test(file)) names.add(file.slice(0, -5));
      }
    } catch (_) {}
  }
  return [...names].sort();
}
function saveProfile(name) {
  const state = load();
  const target = cleanName(name || state.activeProfile);
  if (target !== state.activeProfile) clearStateSecrets(state);
  state.activeProfile = target;
  writeMetadata(profilePath(target), state);
  save();
  return target;
}
function switchProfile(name) {
  const current = load();
  const target = cleanName(name);
  writeMetadata(profilePath(current.activeProfile), current);
  clearStateSecrets(current);
  const next = defaults(readMetadata(profilePath(target)), target);
  if (runtime.isOffline()) offlineCache = next;
  else cache = next;
  save();
  return next;
}
// Retain the argument signature for older callers, but never export secrets.
function exportVault(_options = {}) {
  return metadata(load());
}
function importVault(value, _options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid vault data");
  const s = load();
  const incomingId = cleanAccountId(value.accountId);
  if (value.accountId != null && value.accountId !== "" && !incomingId) throw new Error("Invalid imported account identity.");
  const containsActivity = ["totals", "recentIds", "acceptedGameIds", "lastRun"].some(key => Object.hasOwn(value, key));
  if (s.accountId && incomingId && s.accountId !== incomingId) {
    throw new Error("This import belongs to a different account. Use a different --profile.");
  }
  if (s.accountId && !incomingId && containsActivity) {
    throw new Error("Activity imports must identify the same account as this profile. Import settings only or use a fresh --profile.");
  }
  if (!s.accountId && incomingId && hasActivity(s)) {
    throw new Error("Existing activity has no verified account identity. Import into a fresh --profile.");
  }
  if (!s.accountId && incomingId) {
    clearStateSecrets(s);
    s.accountId = incomingId;
  }
  if (value.settings) s.settings = sanitizeSettings({ ...s.settings, ...record(value.settings) });
  if (value.totals) s.totals = cleanTotals({ ...s.totals, ...record(value.totals) });
  if (Array.isArray(value.recentIds)) s.recentIds = cleanIds(value.recentIds, true);
  if (Array.isArray(value.acceptedGameIds)) s.acceptedGameIds = cleanIds(value.acceptedGameIds);
  // Imported files cannot alter credentials or the currently selected profile.
  save();
  return s;
}
function resetForTests() {
  clearSecrets();
  cache = null;
  offlineCache = null;
}

module.exports = {
  load, save, tokenFresh, rotateMemory, listProfiles, saveProfile, switchProfile, bindAccount,
  exportVault, importVault, profilePath, clearSecrets, sanitizeSettings, resetForTests,
};
