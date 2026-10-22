"use strict";

/**
 * dynamic .env mirror. pure Node — no external dotenv package required.
 * Termux-friendly.
 */

const fs = require("fs");
const { PATHS } = require("./config");
const { CH, pass, fail, info } = require("./log");

const ENV_PATH = PATHS.envFile;

function escapeValue(value) {
  const v = String(value).replace(/"/g, "'");
  return `"${v}"`;
}

function parseExisting() {
  const map = new Map();
  if (!fs.existsSync(ENV_PATH)) return map;
  try {
    const lines = fs.readFileSync(ENV_PATH, "utf-8").split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      map.set(line.slice(0, eq).trim(), val);
    }
  } catch (_) {}
  return map;
}

function serialize(map) {
  const header = "# discord-badge-spoofer credentials (local only)\n";
  let body = "";
  if (map.has("DISCORD_TOKEN")) body += `DISCORD_TOKEN=${map.get("DISCORD_TOKEN")}\n`;
  if (map.has("CF_CLEARANCE_COOKIE")) body += `CF_CLEARANCE_COOKIE=${map.get("CF_CLEARANCE_COOKIE")}\n`;
  return header + body;
}

function upsert(key, value) {
  if (!value) return false;
  const map = parseExisting();
  const val = escapeValue(value);
  const changed = map.get(key) !== val;
  map.set(key, val);
  try {
    fs.writeFileSync(ENV_PATH, serialize(map), "utf-8");
  } catch (e) {
    fail(`couldn't write ${ENV_PATH} ${CH.dim}(${e && e.message ? e.message : e})${CH.reset}`);
    return false;
  }
  return changed;
}

function sync({ token, cookie }) {
  let wrote = false;
  if (token) wrote = upsert("DISCORD_TOKEN", token) || wrote;
  if (cookie) wrote = upsert("CF_CLEARANCE_COOKIE", cookie) || wrote;
  return wrote;
}

/** Load .env into process.env without printing secrets. */
function loadQuiet() {
  const map = parseExisting();
  for (const [k, v] of map) {
    if (process.env[k] == null || process.env[k] === "") process.env[k] = v;
  }
  return map;
}

function loadAndPrint() {
  const map = loadQuiet();
  if (!map.size) {
    info(`no records in ${ENV_PATH} yet`);
    return null;
  }
  pass(`loaded ${CH.orange}${map.size}${CH.reset} record(s) from ${ENV_PATH}`);
  for (const [key, value] of map) {
    const shown =
      value.length > 24 ? value.slice(0, 10) + "…" + value.slice(-6) : value;
    console.log(`    ${CH.cyan}${key}${CH.reset} ${CH.dim}=${CH.reset} ${CH.white}${shown}${CH.reset}`);
  }
  return Object.fromEntries(map);
}

module.exports = { sync, loadAndPrint, loadQuiet, ENV_PATH };
