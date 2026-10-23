"use strict";

const fs = require("fs");
const path = require("path");
const { PATHS } = require("./config");

const FILE = path.join(path.dirname(PATHS.vault), "checkpoint.json");

function load() {
  try {
    if (!fs.existsSync(FILE)) return null;
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch (_) {
    return null;
  }
}

function save(data) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (_) {}
}

function clear() {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch (_) {}
}

module.exports = { load, save, clear, FILE };
