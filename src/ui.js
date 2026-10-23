"use strict";

/**
 * Interactive terminal UI — banner, status strip, sectioned menu, prompts.
 */

const readline = require("readline/promises");
const { CH, line, blank, plain, info } = require("./log");
const { ORCA } = require("./banner");
const { LIMITS } = require("./config");
const vault = require("./vault");
const fmt = require("./format");
const checkpoint = require("./checkpoint");

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

function section(title) {
  plain(`${CH.dim}── ${CH.reset}${CH.white}${title}${CH.reset} ${CH.dim}${"─".repeat(Math.max(4, 36 - title.length))}${CH.reset}`);
}

function opt(key, name, desc) {
  plain(
    `  ${CH.orange}${String(key).padEnd(3)}${CH.reset}${CH.white}${name.padEnd(22)}${CH.reset}${CH.dim}${desc}${CH.reset}`
  );
}

function paint() {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
  blank();
  for (const row of ORCA.art) plain(`${CH.orange}${row}${CH.reset}`);
  plain(`${CH.dim}  ${ORCA.tagline}${CH.reset}`);
  blank();

  const s = vault.load();
  const auth = s.token ? (s.cookie ? `${CH.green}ready${CH.reset}` : `${CH.yellow}no cookie${CH.reset}`) : `${CH.red}no token${CH.reset}`;
  const mint =
    s.analyticsToken && Date.now() - s.mintedAt < LIMITS.tokenTTL
      ? `${CH.green}fresh${CH.reset}`
      : `${CH.yellow}stale${CH.reset}`;
  const pace = s.settings.pace === "drip" ? `${CH.cyan}drip${CH.reset}` : `${CH.orange}aggressive${CH.reset}`;
  const cp = checkpoint.load();

  plain(
    `  ${CH.dim}profile${CH.reset} ${CH.white}${s.activeProfile || "default"}${CH.reset}` +
      `  ${CH.dim}·${CH.reset}  ${CH.dim}auth${CH.reset} ${auth}` +
      `  ${CH.dim}·${CH.reset}  ${CH.dim}session${CH.reset} ${mint}` +
      `  ${CH.dim}·${CH.reset}  ${CH.dim}pace${CH.reset} ${pace}`
  );
  plain(
    `  ${CH.dim}vault${CH.reset}  ${CH.white}${fmt.hours(s.totals.hours)}${CH.reset} play` +
      `  ${CH.dim}·${CH.reset}  ${CH.white}${fmt.hours(s.totals.streamHours || 0)}${CH.reset} stream` +
      `  ${CH.dim}·${CH.reset}  ${CH.white}${fmt.int(s.totals.varietyTitles || 0)}${CH.reset} variety` +
      `  ${CH.dim}·${CH.reset}  ${CH.white}${fmt.int(s.totals.runs)}${CH.reset} runs`
  );
  if (s.settings.dryRun) plain(`  ${CH.yellow}DRY RUN ON — nothing will be sent${CH.reset}`);
  if (cp) {
    plain(
      `  ${CH.cyan}checkpoint${CH.reset} ${cp.mode || "?"} @ ${cp.index || 0}/${cp.total || "?"} ${CH.dim}(re-run same mode to resume)${CH.reset}`
    );
  }
  if (s.settings.catalogFilter && s.settings.catalogFilter !== "all") {
    plain(`  ${CH.dim}filter${CH.reset} ${s.settings.catalogFilter}`);
  }
  line();
}

function paintMenu() {
  paint();

  section("FORGE");
  opt("1", "playtime", "game-time hours across catalog");
  opt("2", "on titles", "search catalog · pick exact games");
  opt("3", "stream hours", "video_stream science (best-effort)");
  opt("4", "games played", "variety badge · ~1 min / title");
  opt("5", "all badges", "playtime + stream + variety");
  opt("6", "next tier", "auto-fill gap to next ladder step");

  blank();
  section("PROGRESS");
  opt("7", "badge ladder", "tiers · vault estimates · next gap");

  blank();
  section("SESSION");
  opt("8", "renew session", "re-mint analytics · swap cookie");
  opt("9", "fingerprint", "Windows PE or synthetic (Termux)");

  blank();
  section("TOOLS");
  opt("10", "tools…", "probe · catalog · settings · journal · profiles · checkpoint");
  opt("x", "exit", "quit");

  line();
  plain(`${CH.dim}  tip: node index.js --auto --mode all --hours 2 --titles 40${CH.reset}`);
  plain(`${CH.dim}  tip: --pace drip  ·  --target 500  ·  --preset max-variety  ·  --profile alt${CH.reset}`);
  line();
}

async function showMenu(ctx) {
  const actions = require("./features");
  const choice = (await ask(`  ${CH.orange}❯${CH.reset} `)).toLowerCase();
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
    case "10":
    case "0": // keep 0 as alias
      await actions.toolsSubmenu(ctx);
      break;
    case "x":
    case "q":
    case "":
      return false;
    default:
      info(`unknown option ${CH.dim}${choice}${CH.reset} — use 1–10 or x`);
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
  section,
  opt,
};
