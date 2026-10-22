"use strict";

/**
 * static knobs for the forge. paths, endpoints, client identity, defaults.
 * Termux / Linux / Windows safe.
 */

const path = require("path");

const ROOT = path.join(__dirname, "..");

const PATHS = {
  vault: path.join(ROOT, "vault.json"),
  legacyVault: path.join(ROOT, "science_state.json"),
  journal: path.join(ROOT, "journal.jsonl"),
  envFile: path.join(ROOT, ".env"),
  gameList: path.join(ROOT, "data", "games.json"), // fixed: inside repo
};

const ENDPOINTS = {
  identity: "https://discord.com/api/v9/users/@me?with_analytics_token=true",
  science: "https://discord.com/api/v9/science",
  props: "https://cordapi.dolfi.es/api/v2/properties/windows",
  catalog: "https://cdn.discordapp.com/detectables/games.json",
};

const LIMITS = {
  tokenTTL: 12 * 60 * 60 * 1000,
  journalTail: 15,
  replayMemory: 800,
};

const CLIENT = {
  release: "1.0.9253",
  build: 594031,
  nativeBuild: 88414,
  osRelease: "10.0.26200",
  electron: "42.7.1",
  locale: "en-GB",
  timezone: "Europe/Oslo",
  agent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) discord/1.0.9253 Chrome/148.0.7778.280 " +
    "Electron/42.7.1 Safari/537.36",
};

const DEFAULT_SETTINGS = {
  batchSize: 50,
  batchPauseMs: 300,
  wobble: true,
  dryRun: false,
  hoursDefault: 1,
};

module.exports = { PATHS, ENDPOINTS, LIMITS, CLIENT, DEFAULT_SETTINGS };
