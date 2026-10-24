"use strict";

// Modified 2026-10-24: no .env files are read or written. Only explicit,
// process-scoped credentials are accepted; their values are never printed.
const runtime = require("./runtime");
const { info } = require("./log");

function sync(_credentials = {}) {
  // Compatibility no-op. Callers already keep credentials in the memory vault.
  return false;
}
function loadQuiet() {
  const values = new Map();
  if (runtime.isOffline()) return values;
  for (const key of ["DISCORD_TOKEN", "CF_CLEARANCE_COOKIE"]) {
    if (typeof process.env[key] === "string" && process.env[key].trim()) {
      values.set(key, process.env[key].trim());
    }
  }
  return values;
}
function loadAndPrint() {
  const values = loadQuiet();
  info(runtime.isOffline()
    ? "Offline preview: credentials are not read."
    : `${values.size} process credential value(s) available; values are hidden.`);
  return Object.fromEntries([...values.keys()].map((key) => [key, "present"]));
}

module.exports = { sync, loadAndPrint, loadQuiet, ENV_PATH: null };
