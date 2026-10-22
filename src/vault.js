"use strict";

/**
 * v2 persisted state ("vault"). holds credentials, fingerprint, settings,
 * playtime counters, rotation memory, and optional viewer (alt) token for
 * dual-account stream forging.
 */

const fs = require("fs");
const { PATHS, LIMITS, DEFAULT_SETTINGS } = require("./config");

let cache = null;

function defaults() {
  return {
    version: 2,
    token: "",
    cookie: "",
    fingerprint: "",
    analyticsToken: "",
    mintedAt: 0,
    // dual-token stream (optional alt that "watches")
    viewerToken: "",
    viewerCookie: "",
    viewerAnalyticsToken: "",
    viewerMintedAt: 0,
    streamGuildId: "",
    streamChannelId: "",
    settings: { ...DEFAULT_SETTINGS },
    totals: { titles: 0, hours: 0, runs: 0, streamHours: 0 },
    lastRun: null,
    recentIds: [],
  };
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
        version: 2,
        token: old.token || "",
        cookie: old.cookie || "",
        fingerprint: old.fingerprint || "",
        analyticsToken: old.analytics_token || "",
        mintedAt: old.fetched_at || 0,
        viewerToken: "",
        viewerCookie: "",
        viewerAnalyticsToken: "",
        viewerMintedAt: 0,
        streamGuildId: "",
        streamChannelId: "",
        settings: { ...DEFAULT_SETTINGS },
        totals: {
          titles: old.total_games_claimed || 0,
          hours: old.total_hours_claimed || 0,
          runs: 0,
          streamHours: 0,
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
  cache.totals = { titles: 0, hours: 0, runs: 0, streamHours: 0, ...(cache.totals || {}) };
  cache.recentIds = Array.isArray(cache.recentIds) ? cache.recentIds.slice(-LIMITS.replayMemory) : [];
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

function viewerTokenFresh() {
  const s = load();
  if (!s.viewerToken || !s.viewerAnalyticsToken) return false;
  return Date.now() - s.viewerMintedAt < LIMITS.tokenTTL;
}

function rotateMemory(ids) {
  const s = load();
  s.recentIds = s.recentIds.concat(ids).slice(-LIMITS.replayMemory);
  save();
}

module.exports = { load, save, tokenFresh, viewerTokenFresh, rotateMemory };
