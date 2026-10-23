"use strict";

const readline = require("readline/promises");
const { CH, line, blank, plain, info } = require("./log");
const { ORCA } = require("./banner");
const { LIMITS } = require("./config");
const vault = require("./vault");
const fmt = require("./format");
let rl = null;

function getRl() {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}

async function ask(question) {
  const answer = await getRl().question(question);
  return String(answer).trim();
}

function closeRl() {
  if (rl) {
    try {
      rl.close();
    } catch (_) {}
    rl = null;
  }
}

function paint() {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
  blank();
  for (const row of ORCA.art) plain(`${CH.orange}${row}${CH.reset}`);
  plain(`${CH.dim}  ${ORCA.tagline}${CH.reset}`);
  blank();
  const s = vault.load();
  const auth = s.token ? (s.cookie ? "ready" : "no cookie") : "no token";
  const mint = s.analyticsToken && Date.now() - s.mintedAt < LIMITS.tokenTTL ? "fresh" : "stale";
  plain(
    `  ${CH.dim}profile${CH.reset} ${s.activeProfile || "default"}  ${CH.dim}·${CH.reset}  ${CH.dim}auth${CH.reset} ${auth}  ${CH.dim}·${CH.reset}  ${CH.dim}session${CH.reset} ${mint}`
  );
  plain(
    `  ${CH.dim}forged${CH.reset} ${fmt.int(s.totals.titles)} titles / ${fmt.hours(s.totals.hours)} play · ${fmt.hours(s.totals.streamHours || 0)} stream · ${fmt.int(s.totals.varietyTitles || 0)} variety  ${CH.dim}pace=${s.settings.pace}${CH.reset}`
  );
  line();
}

function paintMenu() {
  paint();
  const options = [
    ["1", "forge playtime", "game-time badge"],
    ["2", "forge on titles", "search & pick"],
    ["3", "forge stream hours", "streaming science"],
    ["4", "forge games played", "variety badge"],
    ["5", "forge all badges", "play + stream + variety"],
    ["6", "forge to next tier", "auto gap to next ladder step"],
    ["7", "badge ladder", "tiers + vault progress"],
    ["8", "renew session", "token / cookie"],
    ["9", "bind fingerprint", "win PE / synthetic"],
    ["0", "tools / profiles", "settings, journal, export…"],
    ["x", "exit", ""],
  ];
  for (const [num, name, desc] of options) {
    plain(`${CH.orange}${num}${CH.reset} ${CH.white}${name.padEnd(22)}${CH.reset} ${CH.dim}${desc}${CH.reset}`);
  }
  line();
}

async function showMenu(ctx) {
  const actions = require("./features");
  const choice = (await ask(`  ${CH.orange}❯${CH.reset} select: `)).toLowerCase();
  blank();
  switch (choice) {
    case "1":
      await actions.forgeBulk(ctx);
      break;
    case "2":
      await actions.forgeTitles(ctx);
      break;
    case "3":
      await actions.forgeStream(ctx);
      break;
    case "4":
      await actions.forgeVariety(ctx);
      break;
    case "5":
      await actions.forgeAll(ctx);
      break;
    case "6":
      await actions.forgeToNextTier(ctx);
      break;
    case "7":
      await actions.showLadder(ctx);
      break;
    case "8":
      await actions.renewSession(ctx);
      break;
    case "9":
      await actions.bindFingerprint(ctx);
      break;
    case "0":
      await actions.toolsSubmenu(ctx);
      break;
    case "x":
    case "":
      return false;
    default:
      info("unknown option");
  }
  return true;
}

async function askNumber(promptText, fallback, { integer = false, min = 0 } = {}) {
  const raw = await ask(promptText);
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min) return null;
  return n;
}

async function confirm(question) {
  const a = (await ask(`${question} ${CH.dim}[y/N]${CH.reset} `)).toLowerCase();
  return a === "y" || a === "yes";
}

async function chooseGames(gamesList, preselected = null) {
  let pool = preselected || gamesList;
  if (!pool.length) {
    info("no titles matched");
    return [];
  }
  pool.slice(0, 30).forEach((g, i) => {
    plain(`  ${CH.dim}${String(i + 1).padStart(2)}${CH.reset} ${g.name} ${CH.dim}<${g.id}>${CH.reset}`);
  });
  const raw = await ask(`  ${CH.dim}pick (comma/ranges, enter=first 5, a=all):${CH.reset} `);
  const idxs = [];
  if (!raw.trim()) idxs.push(0, 1, 2, 3, 4);
  else if (raw.toLowerCase() === "a") pool.forEach((_, i) => idxs.push(i));
  else {
    for (const part of raw.split(",")) {
      const p = part.trim();
      if (!p) continue;
      const bounds = p.split("-").map((x) => parseInt(x, 10));
      if (bounds.length === 2 && bounds.every(Number.isInteger)) {
        for (let i = Math.min(...bounds); i <= Math.max(...bounds); i++) idxs.push(i - 1);
      } else if (Number.isInteger(bounds[0])) idxs.push(bounds[0] - 1);
    }
  }
  return [...new Set(idxs)].filter((i) => i >= 0 && i < pool.length).map((i) => pool[i]);
}

module.exports = {
  ask,
  closeRl,
  paint,
  paintMenu,
  showMenu,
  askNumber,
  confirm,
  chooseGames,
};
