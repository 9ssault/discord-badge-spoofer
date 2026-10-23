"use strict";

/**
 * v3 vault — multi-profile credentials + settings + totals.
 * Active profile stored in vault.json; named profiles under profiles/.
 */

const fs = require("fs");
const path = require("path");
const { PATHS, LIMITS, DEFAULT_SETTINGS } = require("./config");

let cache = null;

function defaults() {
  return {
    version: 3,
    activeProfile: "default",
    token: "",
    cookie: "",
    fingerprint: "",
    analyticsToken: "",
    mintedAt: 0,
    settings: { ...DEFAULT_SETTINGS },
    totals: { titles: 0, hours: 0, runs: 0, streamHours: 0, varietyTitles: 0 },
    lastRun: null,
    recentIds: [],
  };
}

function ensureProfilesDir() {
  try {
    fs.mkdirSync(PATHS.profilesDir, { recursive: true });
  } catch (_) {}
}

function profilePath(name) {
  const safe = String(name || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(PATHS.profilesDir, `${safe}.json`);
}

function load() {
  if (cache) return cache;
  let data = null;

  if (fs.existsSync(PATHS.vault)) {
    try {
      data = JSON.parse(fs.readFileSync(PATHS.vault, "utf-8"));
    } catch (_) {
      data = null;
    }
  }
  if (!data && fs.existsSync(PATHS.legacyVault)) {
    try {
      const old = JSON.parse(fs.readFileSync(PATHS.legacyVault, "utf-8"));
      data = {
        version: 3,
        activeProfile: "default",
        token: old.token || "",
        cookie: old.cookie || "",
        fingerprint: old.fingerprint || "",
        analyticsToken: old.analytics_token || "",
        mintedAt: old.fetched_at || 0,
        settings: { ...DEFAULT_SETTINGS },
        totals: {
          titles: old.total_games_claimed || 0,
          hours: old.total_hours_claimed || 0,
          runs: 0,
          streamHours: 0,
          varietyTitles: 0,
        },
        lastRun: null,
        recentIds: (old.used_games || []).slice(-LIMITS.replayMemory),
      };
    } catch (_) {
      data = null;
    }
  }
  cache = { ...defaults(), ...(data || {}) };
  cache.settings = { ...DEFAULT_SETTINGS, ...(cache.settings || {}) };
  cache.totals = {
    titles: 0,
    hours: 0,
    runs: 0,
    streamHours: 0,
    varietyTitles: 0,
    ...(cache.totals || {}),
  };
  delete cache.viewerToken;
  delete cache.viewerCookie;
  delete cache.viewerAnalyticsToken;
  delete cache.viewerMintedAt;
  delete cache.streamGuildId;
  delete cache.streamChannelId;
  cache.recentIds = Array.isArray(cache.recentIds)
    ? cache.recentIds.slice(-LIMITS.replayMemory)
    : [];
  if (!cache.activeProfile) cache.activeProfile = "default";
  return cache;
}

function save() {
  if (!cache) return;
  try {
    fs.writeFileSync(PATHS.vault, JSON.stringify(cache, null, 2), "utf-8");
  } catch (_) {}
}

function tokenFresh() {
  const s = load();
  if (!s.analyticsToken) return false;
  return Date.now() - s.mintedAt < LIMITS.tokenTTL;
}

function rotateMemory(ids) {
  const s = load();
  s.recentIds = s.recentIds.concat(ids).slice(-LIMITS.replayMemory);
  save();
}

function listProfiles() {
  ensureProfilesDir();
  const names = new Set(["default"]);
  try {
    for (const f of fs.readdirSync(PATHS.profilesDir)) {
      if (f.endsWith(".json")) names.add(f.replace(/\.json$/, ""));
    }
  } catch (_) {}
  const s = load();
  if (s.activeProfile) names.add(s.activeProfile);
  return [...names].sort();
}

/** Snapshot current vault into named profile file. */
function saveProfile(name) {
  ensureProfilesDir();
  const s = load();
  const snap = {
    version: 3,
    name: name || s.activeProfile || "default",
    token: s.token,
    cookie: s.cookie,
    fingerprint: s.fingerprint,
    analyticsToken: s.analyticsToken,
    mintedAt: s.mintedAt,
    settings: s.settings,
    totals: s.totals,
    lastRun: s.lastRun,
    recentIds: s.recentIds,
  };
  fs.writeFileSync(profilePath(snap.name), JSON.stringify(snap, null, 2), "utf-8");
  s.activeProfile = snap.name;
  save();
  return snap.name;
}

/** Load named profile into active vault. */
function switchProfile(name) {
  const p = profilePath(name);
  if (name !== "default" && !fs.existsSync(p)) {
    // create empty profile from defaults keeping nothing
    const blank = defaults();
    blank.activeProfile = name;
    cache = blank;
    save();
    saveProfile(name);
    return load();
  }
  // save current first if named
  const cur = load();
  if (cur.activeProfile && cur.token) {
    try {
      saveProfile(cur.activeProfile);
    } catch (_) {}
  }
  let data = null;
  if (fs.existsSync(p)) {
    data = JSON.parse(fs.readFileSync(p, "utf-8"));
  } else {
    data = defaults();
  }
  cache = {
    ...defaults(),
    ...data,
    activeProfile: name,
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    totals: {
      titles: 0,
      hours: 0,
      runs: 0,
      streamHours: 0,
      varietyTitles: 0,
      ...(data.totals || {}),
    },
  };
  save();
  return cache;
}

function exportVault({ redact = true } = {}) {
  const s = load();
  const out = JSON.parse(JSON.stringify(s));
  if (redact) {
    if (out.token) out.token = out.token.slice(0, 8) + "…REDACTED";
    if (out.cookie) out.cookie = "…REDACTED";
    if (out.analyticsToken) out.analyticsToken = "…REDACTED";
  }
  return out;
}

function importVault(obj, { mergeCreds = true } = {}) {
  const s = load();
  if (!obj || typeof obj !== "object") throw new Error("invalid vault data");
  if (mergeCreds) {
    if (obj.token && !String(obj.token).includes("REDACTED")) s.token = obj.token;
    if (obj.cookie && !String(obj.cookie).includes("REDACTED")) s.cookie = obj.cookie;
    if (obj.fingerprint) s.fingerprint = obj.fingerprint;
  }
  if (obj.settings) s.settings = { ...s.settings, ...obj.settings };
  if (obj.totals) s.totals = { ...s.totals, ...obj.totals };
  if (Array.isArray(obj.recentIds)) s.recentIds = obj.recentIds.slice(-LIMITS.replayMemory);
  save();
  return s;
}

module.exports = {
  load,
  save,
  tokenFresh,
  rotateMemory,
  listProfiles,
  saveProfile,
  switchProfile,
  exportVault,
  importVault,
  profilePath,
};
