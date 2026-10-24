"use strict";

const fs = require("fs");
const path = require("path");
const { PATHS, ENDPOINTS } = require("./config");
const runtime = require("./runtime");
const { request } = require("./http");

const LAUNCHER_HINTS = [
  "launcher",
  "steam.exe",
  "epicgameslauncher",
  "origin.exe",
  "uplay",
  "battlenet",
  "riotclient",
  "galaxyclient",
  "bethesda",
];

function windowsExecutable(entry) {
  for (const exe of Array.isArray(entry.executables) ? entry.executables : []) {
    if (exe && exe.os === "win32" && typeof exe.name === "string" && exe.name.trim()) return exe.name;
  }
  return "game.exe";
}

function parseCatalog(raw) {
  const data = JSON.parse(raw);
  const seen = new Set();
  const games = [];
  for (const entry of Array.isArray(data) ? data : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (typeof entry.id === "number" && !Number.isSafeInteger(entry.id)) continue;
    if (entry.name != null && typeof entry.name !== "string") continue;
    const id = String(entry && entry.id != null ? entry.id : "");
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    const execs = Array.isArray(entry.executables) ? entry.executables : [];
    if (!execs.some((e) => e && e.os === "win32" && typeof e.name === "string" && e.name.trim())) continue;
    seen.add(id);
    const exe = windowsExecutable(entry);
    const name = entry.name || "Unknown";
    const distributors = entry.distributors || entry.distributor || [];
    const dist = Array.isArray(distributors)
      ? distributors.map((d) => String(d).toLowerCase())
      : [String(distributors).toLowerCase()];
    games.push({
      id,
      name,
      exe,
      verified: entry.verified === true,
      steam: dist.some((d) => d.includes("steam")) || /steam/i.test(exe),
      launcher: LAUNCHER_HINTS.some((h) => exe.toLowerCase().includes(h) || name.toLowerCase().includes(h)),
    });
  }
  return games;
}

function applyFilter(games, filter) {
  const f = (filter || "all").toLowerCase();
  if (f === "all" || !f) return games;
  if (f === "verified") return games.filter((g) => g.verified);
  if (f === "steam") return games.filter((g) => g.steam);
  if (f === "no-launcher" || f === "nolauncher") return games.filter((g) => !g.launcher);
  return games;
}

async function downloadCatalog() {
  const res = await request(ENDPOINTS.catalog, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`catalog http ${res.status}`);
  const raw = await res.text();
  try {
    fs.mkdirSync(path.dirname(PATHS.gameList), { recursive: true });
    fs.writeFileSync(PATHS.gameList, raw, "utf-8");
  } catch (_) {}
  return raw;
}

async function loadGames() {
  if (runtime.isOffline()) return demoCatalog();
  let raw = "";
  if (fs.existsSync(PATHS.gameList)) {
    try {
      raw = fs.readFileSync(PATHS.gameList, "utf-8").trim();
    } catch (_) {
      raw = "";
    }
  }
  if (raw) {
    try {
      const games = parseCatalog(raw);
      if (games.length) return games;
    } catch (_) {}
  }
  try {
    return parseCatalog(await downloadCatalog());
  } catch (_) {
    return [];
  }
}

function searchGames(games, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return games.slice(0, 25);
  return games.filter((g) => g.name.toLowerCase().includes(q)).slice(0, 25);
}

// Clearly fictional records for a genuinely offline, credential-free preview.
// Live loading never uses these records or falls back to them.
function demoCatalog() {
  return Array.from({ length: 120 }, (_, i) => ({
    id: String(900000000000000000n + BigInt(i)),
    name: `Demo Game ${String(i + 1).padStart(3, "0")}`,
    exe: `demo-${i + 1}.exe`, verified: true, steam: i % 2 === 0,
    launcher: false, demo: true,
  }));
}

module.exports = { loadGames, parseCatalog, searchGames, applyFilter, demoCatalog };
