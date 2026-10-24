"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PATHS } = require("./config");
const runtime = require("./runtime");

const FILE = PATHS.checkpoint || path.join(path.dirname(PATHS.vault), "checkpoint.json");

function createPlan({ accountId, profile, mode, gameIds, durationsMs }) {
  if (!accountId || !profile || !mode || !Array.isArray(gameIds) || !Array.isArray(durationsMs) ||
      gameIds.length !== durationsMs.length || gameIds.some((id) => !String(id)) ||
      durationsMs.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Incomplete checkpoint plan.");
  }
  const plan = { accountId: String(accountId), profile: String(profile), mode: String(mode),
    gameIds: gameIds.map(String), durationsMs: durationsMs.slice() };
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  return { ...plan, fingerprint };
}

function load() {
  if (runtime.isOffline()) return null;
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    if (!data || data.version !== 2 || !data.plan || data.plan.fingerprint !== createPlan(data.plan).fingerprint ||
        !Number.isSafeInteger(data.index) || !Number.isSafeInteger(data.total) ||
        data.index < 0 || data.total < 0 || data.index > data.total) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function resumeIndex(plan, total = plan.gameIds.length) {
  const expected = createPlan(plan);
  const data = load();
  if (!data || data.plan.fingerprint !== expected.fingerprint || data.total !== total) return 0;
  if (expected.mode === "stream" && data.index % 2 !== 0) return 0;
  return data.index;
}

function save({ plan, index, total, at = new Date().toISOString() }) {
  if (runtime.isOffline()) return false;
  const canonical = createPlan(plan);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index < 0 || total < index) {
    throw new Error("Invalid checkpoint position.");
  }
  const data = { version: 2, plan: canonical, mode: canonical.mode, index, total, at };
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const temporary = `${FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(temporary, FILE);
  } finally {
    try { fs.unlinkSync(temporary); } catch (_) {}
  }
  return true;
}

function clear() {
  if (runtime.isOffline()) return;
  try { fs.unlinkSync(FILE); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

module.exports = { load, save, clear, createPlan, resumeIndex, FILE };
