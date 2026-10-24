"use strict";
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const DATA_ROOT = path.resolve(process.env.BADGES_DATA_DIR || path.join(ROOT, ".local"));
const PATHS = {
  root: ROOT, dataRoot: DATA_ROOT,
  vault: path.join(DATA_ROOT, "vault.json"),
  legacyVault: path.join(DATA_ROOT, "science_state.json"),
  journal: path.join(DATA_ROOT, "journal.jsonl"),
  envFile: path.join(DATA_ROOT, ".env"),
  gameList: path.join(DATA_ROOT, "games.json"),
  debugDir: path.join(DATA_ROOT, "debug"),
  profilesDir: path.join(DATA_ROOT, "profiles"),
};
const ENDPOINTS = {
  identity: "https://discord.com/api/v9/users/@me?with_analytics_token=true",
  science: "https://discord.com/api/v9/science",
  catalog: "https://cdn.discordapp.com/detectables/games.json",
};
// Upstream identity: undocumented protocol compatibility is not guaranteed.
const CLIENT = {
  release: "1.0.9253", build: 594031, nativeBuild: 88414,
  osRelease: "10.0.26200", electron: "42.7.1", locale: "en-US",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) discord/1.0.9253 Chrome/148.0.7778.280 Electron/42.7.1 Safari/537.36",
};
const LIMITS = {
  tokenTTL: 12 * 3600 * 1000, journalTail: 30, replayMemory: 20000,
  maxRetries: 3, retryBaseMs: 1000, requestTimeoutMs: 20000,
  maxHours: 100000, maxTitles: 20000,
};
const DEFAULT_SETTINGS = {
  batchSize: 20, batchPauseMs: 1500, wobble: false, dryRun: false,
  hoursDefault: 1, pace: "standard", dripHoursPerDay: 4,
  dripPauseMs: 15 * 60 * 1000, catalogFilter: "no-launcher",
  maxRetries: 3, debugDump: false,
};
const PRESETS = {
  "max-variety": { mode: "variety", titles: 100, hours: 1 / 60 },
  "quick-play": { mode: "playtime", titles: 20, hours: 1 },
  "dump-play": { mode: "playtime", titles: 50, hours: 10 },
  "dump-stream": { mode: "stream", hours: 50 },
};
module.exports = { ROOT, PATHS, ENDPOINTS, CLIENT, LIMITS, DEFAULT_SETTINGS, PRESETS };
